"use client";

import { useMemo } from "react";
import { useFeed } from "@/lib/hooks/use-feed";
import { FeedPostCard } from "./feed-post-card";
import type { FeedPost } from "@/lib/types";

function dateLabel(ts: string): string {
  const d = new Date(ts.replace(" ", "T"));
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function groupByDay(posts: FeedPost[]): { label: string; posts: FeedPost[] }[] {
  const groups: { label: string; posts: FeedPost[] }[] = [];
  let currentLabel = "";
  for (const post of posts) {
    const label = dateLabel(post.shared_at);
    if (label !== currentLabel) {
      groups.push({ label, posts: [] });
      currentLabel = label;
    }
    groups[groups.length - 1].posts.push(post);
  }
  return groups;
}

export function FeedView() {
  const { posts, isLoading, mutate, removePost, starPost, unstarPost } = useFeed();

  const groups = useMemo(() => groupByDay(posts), [posts]);

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
    <div className="pt-2 space-y-1">
      {groups.map((group) => (
        <div key={group.label}>
          <p
            className="text-[11px] font-semibold uppercase tracking-wider px-1 pb-2 pt-3"
            style={{ color: "var(--muted-foreground)" }}
          >
            {group.label}
          </p>
          <div className="space-y-3">
            {group.posts.map((post) => (
              <FeedPostCard
                key={post.id}
                post={post}
                onUnshare={post.is_mine ? () => removePost(post.idea_id) : undefined}
                onStar={() => starPost(post.idea_id)}
                onUnstar={() => unstarPost(post.idea_id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
