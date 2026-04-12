"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { mutate as globalMutate } from "swr";
import { ArrowLeft, Star } from "lucide-react";
import { fetchFeedIdea, starFeedPost, unstarFeedPost } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/utils/dates";
import { VoiceMemoPlayer } from "@/components/ui/voice-memo-player";
import { YouTubePreview } from "@/components/ui/youtube-preview";
import { AvatarCircle } from "@/components/feed/avatar-circle";
import { Calendar, Clock } from "lucide-react";
import { toast } from "sonner";

export default function FeedIdeaPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const { ideaId } = use(params);
  const id = Number(ideaId);
  const router = useRouter();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [starredOverride, setStarredOverride] = useState<boolean | null>(null);

  const { data: idea, isLoading } = useSWR(`feed-idea-${id}`, () => fetchFeedIdea(id));

  const isStarred = starredOverride ?? idea?.viewer_starred ?? false;

  const handleStarToggle = async () => {
    if (!idea) return;
    const next = !isStarred;
    setStarredOverride(next);
    try {
      if (next) {
        await starFeedPost(id);
      } else {
        await unstarFeedPost(id);
      }
      globalMutate("feed").catch(() => {});
      globalMutate("feed-starred").catch(() => {});
    } catch {
      setStarredOverride(!next);
      toast.error("Failed to update star.");
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)", paddingBottom: "calc(env(safe-area-inset-bottom) + 48px)" }}>
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-4"
        style={{
          backgroundColor: "var(--background)",
          borderBottom: "1px solid var(--border)",
          paddingTop: "calc(env(safe-area-inset-top) + 12px)",
          paddingBottom: 12,
        }}
      >
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm font-medium"
          style={{ color: "var(--muted-foreground)" }}
        >
          <ArrowLeft size={16} />
          Back
        </button>

        {idea && (
          <button
            onClick={handleStarToggle}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              color: isStarred ? "#facc15" : "var(--muted-foreground)",
            }}
          >
            <Star size={15} fill={isStarred ? "#facc15" : "none"} strokeWidth={isStarred ? 0 : 1.5} />
          </button>
        )}
      </header>

      {/* Loading */}
      {!idea && isLoading && (
        <div className="flex items-center justify-center pt-24" style={{ color: "var(--muted-foreground)" }}>
          Loading…
        </div>
      )}

      {idea && (
        <div className="max-w-lg mx-auto px-4 pt-5 space-y-4">

          {/* Author card */}
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <AvatarCircle username={idea.author.username} avatarUrl={idea.author.avatar_url} size={40} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{idea.author.username}</p>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Shared to feed</p>
            </div>
          </div>

          {/* Timestamp card */}
          <div
            className="flex items-center gap-4 px-4 py-3 rounded-2xl"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-1.5" style={{ color: "var(--muted-foreground)" }}>
              <Calendar size={13} />
              <span className="text-xs font-medium">{formatDate(idea.timestamp)}</span>
            </div>
            <div className="w-px self-stretch" style={{ backgroundColor: "var(--border)" }} />
            <div className="flex items-center gap-1.5" style={{ color: "var(--muted-foreground)" }}>
              <Clock size={13} />
              <span className="text-xs">{formatTime(idea.timestamp)}</span>
            </div>
          </div>

          {/* Content card */}
          {idea.content && (
            <div
              className="px-5 py-4 rounded-2xl"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <p className="text-base leading-relaxed select-text whitespace-pre-wrap"
                style={{ color: "var(--foreground)" }}>
                {idea.content}
              </p>
            </div>
          )}

          {/* YouTube link preview */}
          {idea.content && <YouTubePreview content={idea.content} />}

          {/* Media */}
          {idea.media.length > 0 && (
            <div className="space-y-3">
              {idea.media.map((m) =>
                m.media_type === "video" ? (
                  <video
                    key={m.id}
                    src={m.url}
                    controls
                    className="w-full rounded-2xl"
                    style={{ backgroundColor: "var(--card)" }}
                  />
                ) : m.media_type === "audio" ? (
                  <VoiceMemoPlayer key={m.id} src={m.url} />
                ) : (
                  <button
                    key={m.id}
                    onClick={() => setLightbox(m.url)}
                    className="block w-full overflow-hidden rounded-2xl"
                    style={{ border: "1px solid var(--border)" }}
                  >
                    <img
                      src={m.url}
                      alt=""
                      className="w-full object-contain"
                      style={{
                        backgroundColor: m.media_type === "sketch" ? "#111" : "var(--card)",
                        maxHeight: "70vh",
                      }}
                    />
                  </button>
                )
              )}
            </div>
          )}

          {!idea.content && idea.media.length === 0 && (
            <div
              className="px-5 py-4 rounded-2xl"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <p className="text-sm italic" style={{ color: "var(--muted-foreground)" }}>Empty idea.</p>
            </div>
          )}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-w-full max-h-full object-contain p-4" />
        </div>
      )}
    </div>
  );
}
