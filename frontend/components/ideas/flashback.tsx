"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Shuffle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { Idea } from "@/lib/types";
import { fetchOnThisDay, fetchRandomIdea } from "@/lib/api";

// Flashback fetches its content directly from the server so it reaches across the
// user's entire history — not just whatever the paginated feed currently has loaded.
interface FlashbackProps {
  ideas?: Idea[]; // unused but kept for API compat with existing callers
}

function timeAgoLabel(dateStr: string): string {
  const then = new Date(dateStr.replace(" ", "T"));
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 7) return `${days} day${days !== 1 ? "s" : ""} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks !== 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months !== 1 ? "s" : ""} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years !== 1 ? "s" : ""} ago`;
}

function IdeaPreview({ idea, label }: { idea: Idea; label: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(`/ideas/${idea.id}`)}
      className="w-full text-left"
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
        style={{ color: "var(--muted-foreground)", opacity: 0.6 }}
      >
        {label}
      </p>
      <p
        className="text-sm leading-relaxed line-clamp-3"
        style={{ color: "var(--foreground)" }}
      >
        {idea.content || (idea.has_media ? "Photo / media" : "Empty idea")}
      </p>
      {idea.has_media && idea.media.length > 0 && idea.media[0].media_type !== "video" && (
        <img
          src={idea.media[0].url}
          alt=""
          className="w-full h-32 rounded-lg object-cover mt-2"
        />
      )}
    </button>
  );
}

const OTD_CACHE_KEY = "tt-flashback-otd-cache";

function readOtdCache(): { ideas: Idea[] } | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(OTD_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { ideas: Idea[]; day: string };
    // Invalidate if the cache was written on a different local day — "On This Day"
    // is date-dependent, so yesterday's entries are wrong today.
    const today = new Date().toLocaleDateString("en-CA");
    if (parsed.day !== today) return undefined;
    return { ideas: parsed.ideas };
  } catch {
    return undefined;
  }
}

function writeOtdCache(data: { ideas: Idea[] }) {
  if (typeof window === "undefined") return;
  try {
    const today = new Date().toLocaleDateString("en-CA");
    localStorage.setItem(OTD_CACHE_KEY, JSON.stringify({ ideas: data.ideas, day: today }));
  } catch {
    // Quota exceeded — ignore, SWR still works.
  }
}

export function Flashback(_props: FlashbackProps) {
  // On This Day — cached in localStorage so cold start paints from disk instantly
  // instead of waiting on the Flask round-trip through the Tailscale funnel.
  const { data: onThisDay } = useSWR("flashback-otd", () => fetchOnThisDay(), {
    fallbackData: readOtdCache(),
    onSuccess: (d) => writeOtdCache(d),
  });
  const flashbackIdeas = onThisDay?.ideas ?? [];
  const [flashbackIndex, setFlashbackIndex] = useState(0);
  const currentFlashback = flashbackIdeas[flashbackIndex];
  const hasFlashbacks = flashbackIdeas.length > 0;

  // Random — plain fetch, not SWR. SWR's global dedupingInterval (10s) would
  // silently swallow rapid "Another one" taps and return the cached idea.
  const [randomIdea, setRandomIdea] = useState<Idea | null>(null);
  const [randomLoading, setRandomLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const loadRandom = useCallback(async () => {
    setRandomLoading(true);
    try {
      const res = await fetchRandomIdea(24);
      setRandomIdea(res.idea ?? null);
    } finally {
      setRandomLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRandom();
  }, [loadRandom]);

  const shuffle = useCallback(() => {
    setRevealed(true);
    void loadRandom();
  }, [loadRandom]);

  // Hide the whole block only when we have neither OTD nor any random idea available.
  // (We can't know "random count" without extra queries — instead we show the card
  // optimistically and let the server decide whether it has anything to return.)
  if (!hasFlashbacks && !randomIdea && !randomLoading) return null;

  return (
    <div className="space-y-3 mb-4">
      {/* On This Day */}
      {hasFlashbacks && currentFlashback && (
        <div
          className="rounded-2xl px-4 py-3.5"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <IdeaPreview
            idea={currentFlashback}
            label={`Flashback \u00B7 ${timeAgoLabel(currentFlashback.timestamp)}`}
          />
          {flashbackIdeas.length > 1 && (
            <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
              <button
                onClick={() =>
                  setFlashbackIndex((i) => (i - 1 + flashbackIdeas.length) % flashbackIdeas.length)
                }
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: "var(--muted)" }}
              >
                <ChevronLeft size={14} style={{ color: "var(--muted-foreground)" }} />
              </button>
              <span className="text-[10px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                {flashbackIndex + 1} of {flashbackIdeas.length}
              </span>
              <button
                onClick={() =>
                  setFlashbackIndex((i) => (i + 1) % flashbackIdeas.length)
                }
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: "var(--muted)" }}
              >
                <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Random idea — only shown if the server has at least one old idea */}
      {(randomIdea || randomLoading) && (
        <div
          className="rounded-2xl px-4 py-3.5"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          {revealed && randomIdea ? (
            <>
              <IdeaPreview
                idea={randomIdea}
                label={`Random \u00B7 ${timeAgoLabel(randomIdea.timestamp)}`}
              />
              <button
                onClick={shuffle}
                disabled={randomLoading}
                className="flex items-center gap-1.5 mt-3 pt-2 w-full justify-center disabled:opacity-60"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                {randomLoading ? (
                  <Loader2 size={13} className="animate-spin" style={{ color: "var(--muted-foreground)" }} />
                ) : (
                  <Shuffle size={13} style={{ color: "var(--muted-foreground)" }} />
                )}
                <span className="text-[11px] font-semibold" style={{ color: "var(--muted-foreground)" }}>
                  {randomLoading ? "Loading\u2026" : "Another one"}
                </span>
              </button>
            </>
          ) : (
            <button
              onClick={shuffle}
              disabled={randomLoading}
              className="flex items-center justify-center gap-2 w-full py-2 disabled:opacity-60"
            >
              {randomLoading ? (
                <Loader2 size={16} className="animate-spin" style={{ color: "var(--muted-foreground)" }} />
              ) : (
                <Shuffle size={16} style={{ color: "var(--muted-foreground)" }} />
              )}
              <span className="text-sm font-medium" style={{ color: "var(--muted-foreground)" }}>
                {randomLoading ? "Finding one\u2026" : "Resurface a random idea"}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
