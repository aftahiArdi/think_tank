"use client";

import { useState } from "react";
import { X, Star } from "lucide-react";
import { AvatarCircle } from "./avatar-circle";
import { VoiceMemoPlayer } from "@/components/ui/voice-memo-player";
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
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLightbox, setDetailLightbox] = useState<string | null>(null);

  const images = post.media.filter((m) => m.media_type === "image" || m.media_type === "sketch");
  const videos = post.media.filter((m) => m.media_type === "video");
  const audios = post.media.filter((m) => m.media_type === "audio");

  const handleStarToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (post.viewer_starred) {
      onUnstar?.();
    } else {
      onStar?.();
    }
  };

  return (
    <>
      {/* Card (tappable to open detail) */}
      <div
        className="rounded-2xl px-4 py-3 space-y-2.5 active:opacity-80 transition-opacity"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", cursor: "pointer" }}
        onClick={() => setDetailOpen(true)}
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
            {/* Star button */}
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
                onClick={(e) => { e.stopPropagation(); onUnshare(); }}
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

      {/* Detail sheet */}
      {detailOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
            onClick={() => setDetailOpen(false)}
          />
          <div
            className="fixed left-0 right-0 bottom-0 z-50 rounded-t-3xl overflow-y-auto"
            style={{
              backgroundColor: "var(--background)",
              borderTop: "1px solid var(--border)",
              maxHeight: "92dvh",
              paddingBottom: "max(24px, env(safe-area-inset-bottom))",
            }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1 sticky top-0" style={{ backgroundColor: "var(--background)" }}>
              <div className="w-9 h-1 rounded-full" style={{ backgroundColor: "var(--border)" }} />
            </div>

            <div className="px-4 pb-2 sticky top-6" style={{ backgroundColor: "var(--background)" }}>
              {/* Author header */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <AvatarCircle username={post.author.username} avatarUrl={post.author.avatar_url} size={44} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{post.author.username}</p>
                    <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{timeAgo(post.shared_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleStarToggle}
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--border)",
                      color: post.viewer_starred ? "#facc15" : "var(--muted-foreground)",
                    }}
                  >
                    <Star size={17} fill={post.viewer_starred ? "#facc15" : "none"} strokeWidth={post.viewer_starred ? 0 : 1.5} />
                  </button>
                  <button
                    onClick={() => setDetailOpen(false)}
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
                  >
                    <X size={17} style={{ color: "var(--muted-foreground)" }} />
                  </button>
                </div>
              </div>
            </div>

            <div className="px-4 space-y-4 pb-4">
              {/* Full content */}
              {post.content && (
                <p className="text-base leading-relaxed select-text whitespace-pre-wrap"
                  style={{ color: "var(--foreground)" }}>
                  {post.content}
                </p>
              )}

              {/* Images (tappable → lightbox) */}
              {images.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setDetailLightbox(m.url)}
                  className="block w-full overflow-hidden rounded-2xl"
                  style={{ border: "1px solid var(--border)" }}
                >
                  <img
                    src={m.url}
                    alt=""
                    className="w-full object-contain"
                    style={{
                      backgroundColor: m.media_type === "sketch" ? "#111" : "var(--card)",
                      maxHeight: "60vh",
                    }}
                  />
                </button>
              ))}

              {/* Videos */}
              {videos.map((m) => (
                <video
                  key={m.id}
                  src={m.url}
                  controls
                  className="w-full rounded-2xl"
                  style={{ backgroundColor: "var(--card)" }}
                />
              ))}

              {/* Audio */}
              {audios.map((m) => (
                <VoiceMemoPlayer key={m.id} src={m.url} />
              ))}

              {/* Remove from feed (own posts only) */}
              {post.is_mine && onUnshare && (
                <button
                  onClick={() => { onUnshare(); setDetailOpen(false); }}
                  className="w-full py-3 rounded-2xl text-sm font-medium"
                  style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}
                >
                  Remove from feed
                </button>
              )}
            </div>
          </div>

          {/* Lightbox */}
          {detailLightbox && (
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center"
              style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
              onClick={() => setDetailLightbox(null)}
            >
              <img src={detailLightbox} alt="" className="max-w-full max-h-full object-contain p-4" />
            </div>
          )}
        </>
      )}
    </>
  );
}
