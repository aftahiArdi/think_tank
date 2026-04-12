import useSWR from "swr";
import { fetchFeed, unshareIdea } from "@/lib/api";
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

  return { posts, isLoading, mutate, removePost };
}
