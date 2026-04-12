"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { AvatarCircle } from "./avatar-circle";
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
}

export function FeedPostCard({ post, onUnshare }: FeedPostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const images = post.media.filter((m) => m.media_type === "image" || m.media_type === "sketch");
  const videos = post.media.filter((m) => m.media_type === "video");
  const audios = post.media.filter((m) => m.media_type === "audio");

  return (
    <>
      <div
        className="rounded-2xl px-4 py-3 space-y-2.5"
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
          {post.is_mine && onUnshare && (
            <button
              onClick={onUnshare}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px]"
              style={{ color: "var(--muted-foreground)", backgroundColor: "var(--muted)" }}
            >
              <X size={11} />
              Remove
            </button>
          )}
        </div>

        {/* Content */}
        {post.content && (
          <p
            className="text-sm leading-relaxed"
            style={{
              color: "var(--foreground)",
              display: "-webkit-box",
              WebkitLineClamp: expanded ? undefined : 4,
              WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"],
              overflow: expanded ? "visible" : "hidden",
            }}
            onClick={() => setExpanded((e) => !e)}
          >
            {post.content}
          </p>
        )}

        {/* Images */}
        {images.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {images.map((m) => (
              <button
                key={m.id}
                onClick={() => setLightbox(m.url)}
                className="flex-shrink-0"
              >
                <img
                  src={m.url}
                  alt=""
                  loading="lazy"
                  className="w-20 h-20 rounded-xl object-cover"
                  style={{ backgroundColor: m.media_type === "sketch" ? "#111" : "var(--muted)" }}
                />
              </button>
            ))}
          </div>
        )}

        {/* Video / audio chips */}
        {(videos.length > 0 || audios.length > 0) && (
          <div className="flex gap-2 flex-wrap">
            {videos.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
                style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}
              >
                🎥 Video
              </div>
            ))}
            {audios.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
                style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}
              >
                🎙️ Voice memo
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-w-full max-h-full object-contain p-4" />
        </div>
      )}
    </>
  );
}
