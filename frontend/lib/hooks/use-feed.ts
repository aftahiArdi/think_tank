import useSWR from "swr";
import { fetchFeed, fetchStarredFeedPosts, unshareIdea, starFeedPost, unstarFeedPost } from "@/lib/api";
import type { FeedPost } from "@/lib/types";
import { toast } from "sonner";

export function useFeed() {
  const { data, isLoading, mutate } = useSWR("feed", fetchFeed, {
    revalidateOnFocus: true,
    dedupingInterval: 5000,
  });

  const posts: FeedPost[] = data?.posts ?? [];

  const removePost = async (ideaId: number) => {
    const optimistic = posts.filter((p) => p.idea_id !== ideaId);
    mutate(
      async () => {
        await unshareIdea(ideaId);
        return fetchFeed();
      },
      {
        optimisticData: { posts: optimistic },
        rollbackOnError: true,
      }
    ).catch(() => toast.error("Failed to unshare"));
  };

  const starPost = async (ideaId: number) => {
    const optimistic = posts.map((p) =>
      p.idea_id === ideaId ? { ...p, viewer_starred: true } : p
    );
    mutate(
      async () => {
        await starFeedPost(ideaId);
        return fetchFeed();
      },
      { optimisticData: { posts: optimistic }, rollbackOnError: true }
    ).catch(() => toast.error("Failed to star"));
  };

  const unstarPost = async (ideaId: number) => {
    const optimistic = posts.map((p) =>
      p.idea_id === ideaId ? { ...p, viewer_starred: false } : p
    );
    mutate(
      async () => {
        await unstarFeedPost(ideaId);
        return fetchFeed();
      },
      { optimisticData: { posts: optimistic }, rollbackOnError: true }
    ).catch(() => toast.error("Failed to unstar"));
  };

  return { posts, isLoading, mutate, removePost, starPost, unstarPost };
}

export function useStarredFeedPosts() {
  const { data, isLoading, mutate } = useSWR("feed-starred", fetchStarredFeedPosts, {
    revalidateOnFocus: true,
    dedupingInterval: 5000,
  });

  const posts: FeedPost[] = data?.posts ?? [];

  const unstarPost = async (ideaId: number) => {
    const optimistic = posts.filter((p) => p.idea_id !== ideaId);
    mutate(
      async () => {
        await unstarFeedPost(ideaId);
        return fetchStarredFeedPosts();
      },
      { optimisticData: { posts: optimistic }, rollbackOnError: true }
    ).catch(() => toast.error("Failed to unstar"));
  };

  return { posts, isLoading, unstarPost };
}
