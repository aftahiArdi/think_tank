"use client";

import { useFeed } from "@/lib/hooks/use-feed";
import { FeedPostCard } from "./feed-post-card";

export function FeedView() {
  const { posts, isLoading, mutate, removePost } = useFeed();

  const handleRefresh = async () => {
    await mutate();
  };

  if (isLoading) {
    return (
      <div className="pt-16 flex justify-center" style={{ color: "var(--muted-foreground)" }}>
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="pt-16 text-center px-8" style={{ color: "var(--muted-foreground)" }}>
        <p className="text-2xl mb-3">💬</p>
        <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Nothing shared yet</p>
        <p className="text-xs mt-1">Share an idea from your feed to post it here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-2">
      {posts.map((post) => (
        <FeedPostCard
          key={post.id}
          post={post}
          onUnshare={post.is_mine ? () => removePost(post.idea_id) : undefined}
        />
      ))}
    </div>
  );
}
