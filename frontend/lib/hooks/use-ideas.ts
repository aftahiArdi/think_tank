import { useState, useCallback, useRef } from "react";
import useSWR from "swr";
import { fetchIdeas, createIdea, deleteIdea, updateIdea, starIdea as apiStarIdea } from "@/lib/api";
import { getCurrentUsername } from "@/lib/biometric";
import type { Idea } from "@/lib/types";

// Persist the feed to localStorage so cold opens paint from disk in <50ms instead
// of waiting on the network. Only the most recent slice is cached to stay well under
// the ~5 MB per-origin localStorage quota at 5000+ ideas.
const CACHE_LIMIT = 200;
const PAGE_SIZE = 50;

type FeedResponse = { ideas: Idea[]; next_before: string | null };

const cacheKey = () => {
  const user = getCurrentUsername() ?? "anon";
  return `tt-feed-cache:${user}`;
};

function readFeedCache(): FeedResponse | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as FeedResponse;
    if (!parsed?.ideas) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeFeedCache(data: FeedResponse): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed: FeedResponse = {
      ideas: data.ideas.slice(0, CACHE_LIMIT),
      next_before: data.next_before,
    };
    localStorage.setItem(cacheKey(), JSON.stringify(trimmed));
  } catch {
    // Quota exceeded or storage disabled — silently ignore; SWR still works fine.
  }
}

export function useIdeas(fallbackData?: FeedResponse) {
  // Page 1 — lives in SWR so optimistic mutates and cache hydration keep working.
  const { data, error, isLoading, mutate } = useSWR<FeedResponse>(
    "ideas",
    () => fetchIdeas(undefined, PAGE_SIZE),
    {
      fallbackData: fallbackData ?? readFeedCache(),
      onSuccess: (d) => writeFeedCache(d),
    }
  );

  // Older pages — fetched lazily as the user scrolls. Kept outside SWR so they don't
  // get discarded by optimistic rewrites of page 1.
  const [olderPages, setOlderPages] = useState<Idea[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const page1 = data?.ideas ?? [];
  // Effective cursor: use whatever we've advanced to, else the initial page's cursor.
  const effectiveCursor = olderCursor === undefined ? data?.next_before ?? null : olderCursor;
  const hasMore = effectiveCursor !== null;

  const ideas: Idea[] = olderPages.length > 0 ? [...page1, ...olderPages] : page1;

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !effectiveCursor) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = await fetchIdeas(effectiveCursor, PAGE_SIZE);
      setOlderPages((prev) => [...prev, ...next.ideas]);
      setOlderCursor(next.next_before);
    } catch {
      // Swallow — sentinel will retry on next scroll event if still visible.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, effectiveCursor]);

  // Wrap mutate so pull-to-refresh also resets the paginated tail, otherwise
  // the user would see a stale older-pages list after refreshing.
  const refresh = useCallback(async () => {
    setOlderPages([]);
    setOlderCursor(undefined);
    return mutate();
  }, [mutate]);

  const addIdea = async (content: string, categoryId?: number) => {
    const tempId = -Date.now();
    const optimistic: Idea = {
      id: tempId,
      content,
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
      media_type: "text",
      has_media: false,
      starred: false,
      owner_username: "",
      is_shared: false,
      category: null,
      media: [],
    };

    // Snapshot the pre-mutation list once — SWR passes the pre-optimistic cache
    // to the async updater, so referencing `current?.ideas` there would drop the
    // newly-added row. Build the final list ourselves from a stable snapshot.
    const prevList = data?.ideas ?? page1;
    const prevCursor = data?.next_before ?? null;

    // No post-write refetch: we already know the new row, just swap the temp id
    // for the server-assigned one. Saves a full feed GET round-trip per capture.
    mutate(
      async () => {
        const created = await createIdea(content, categoryId);
        return {
          ideas: [{ ...optimistic, id: created.id }, ...prevList],
          next_before: prevCursor,
        };
      },
      {
        optimisticData: { ideas: [optimistic, ...prevList], next_before: prevCursor },
        rollbackOnError: true,
        revalidate: false,
      }
    );
  };

  const removeIdea = async (id: number) => {
    const prevList = data?.ideas ?? page1;
    const prevCursor = data?.next_before ?? null;
    const nextList = prevList.filter((i) => i.id !== id);

    // No post-write refetch: the local filter is already the correct state.
    mutate(
      async () => {
        await deleteIdea(id);
        return { ideas: nextList, next_before: prevCursor };
      },
      {
        optimisticData: { ideas: nextList, next_before: prevCursor },
        rollbackOnError: true,
        revalidate: false,
      }
    );
    // Also remove from the older-pages tail so it disappears from view immediately.
    setOlderPages((prev) => prev.filter((i) => i.id !== id));
  };

  const patchIdea = async (id: number, dataIn: { content?: string; category_id?: number }) => {
    await updateIdea(id, dataIn);
    mutate();
  };

  const starIdea = async (id: number, starred: boolean) => {
    // Star can happen on an idea from any page — patch both page1 and the tail.
    const patchedPage1 = page1.map((i) => (i.id === id ? { ...i, starred } : i));
    setOlderPages((prev) => prev.map((i) => (i.id === id ? { ...i, starred } : i)));
    mutate(
      async () => {
        await apiStarIdea(id, starred);
        return { ideas: patchedPage1, next_before: data?.next_before ?? null };
      },
      {
        optimisticData: { ideas: patchedPage1, next_before: data?.next_before ?? null },
        rollbackOnError: true,
      }
    );
  };

  return {
    ideas,
    isLoading,
    error,
    mutate: refresh,
    addIdea,
    removeIdea,
    patchIdea,
    starIdea,
    loadMore,
    hasMore,
    loadingMore,
  };
}
