"use client";

import Link from "next/link";
import { X, Star } from "lucide-react";
import { AvatarCircle } from "./avatar-circle";
import { YouTubePreview, extractYouTubeVideoId } from "@/components/ui/youtube-preview";
import { LinkPreview } from "@/components/ui/link-preview";
import type { FeedPost } from "@/lib/types";

function timeAgo(ts: string): string {
  const now = Date.now();
  const then = new Date(ts.replace(" ", "T")).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const d = new Date(ts.replace(" ", "T"));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface FeedPostCardProps {
  post: FeedPost;
  onUnshare?: () => void;
  onStar?: () => void;
  onUnstar?: () => void;
}

export function FeedPostCard({ post, onUnshare, onStar, onUnstar }: FeedPostCardProps) {
  const images = post.media.filter((m) => m.media_type === "image" || m.media_type === "sketch");
  const videos = post.media.filter((m) => m.media_type === "video");
  const audios = post.media.filter((m) => m.media_type === "audio");

  const handleStarToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (post.viewer_starred) {
      onUnstar?.();
    } else {
      onStar?.();
    }
  };

  return (
    <Link
      href={`/feed/${post.idea_id}`}
      prefetch
      style={{ display: "block", textDecoration: "none" }}
    >
      <div
        className="rounded-2xl px-4 py-3 space-y-2.5 active:opacity-80 transition-opacity"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        {/* Author row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AvatarCircle
              username={post.author.username}
              avatarUrl={post.author.avatar_url}
              size={36}
            />
            <div>
              <p className="text-sm font-semibold leading-tight" style={{ color: "var(--foreground)" }}>
                {post.author.username}
              </p>
              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                {timeAgo(post.shared_at)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleStarToggle}
              className="w-8 h-8 flex items-center justify-center rounded-lg"
              style={{ color: post.viewer_starred ? "#facc15" : "var(--muted-foreground)" }}
            >
              <Star
                size={16}
                fill={post.viewer_starred ? "#facc15" : "none"}
                strokeWidth={post.viewer_starred ? 0 : 1.5}
              />
            </button>
            {post.is_mine && onUnshare && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUnshare(); }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px]"
                style={{ color: "var(--muted-foreground)", backgroundColor: "var(--muted)" }}
              >
                <X size={11} />
                Remove
              </button>
            )}
          </div>
        </div>

        {/* Content preview (4-line clamp) */}
        {post.content && (
          <p
            className="text-sm leading-relaxed"
            style={{
              color: "var(--foreground)",
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"],
              overflow: "hidden",
            }}
          >
            {post.content}
          </p>
        )}

        {/* Link preview */}
        {post.content && (
          extractYouTubeVideoId(post.content)
            ? <YouTubePreview content={post.content} stopPropagation />
            : <LinkPreview content={post.content} stopPropagation />
        )}

        {/* Image thumbnails */}
        {images.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {images.map((m) => (
              <img
                key={m.id}
                src={m.url}
                alt=""
                loading="lazy"
                className="w-20 h-20 rounded-xl object-cover flex-shrink-0"
                style={{ backgroundColor: m.media_type === "sketch" ? "#111" : "var(--muted)" }}
              />
            ))}
          </div>
        )}

        {/* Video / audio chips */}
        {(videos.length > 0 || audios.length > 0) && (
          <div className="flex gap-2 flex-wrap">
            {videos.map((m) => (
              <div key={m.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
                style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}>
                🎥 Video
              </div>
            ))}
            {audios.map((m) => (
              <div key={m.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
                style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}>
                🎙️ Voice memo
              </div>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
