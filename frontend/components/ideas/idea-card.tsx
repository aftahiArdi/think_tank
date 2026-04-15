"use client";

import { memo, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { mutate as globalMutate } from "swr";
import { Star, Play } from "lucide-react";
import type { Idea } from "@/lib/types";
import { GlowCard } from "@/components/ui/glow-card";
import { YouTubePreview, extractYouTubeVideoId } from "@/components/ui/youtube-preview";
import { LinkPreview } from "@/components/ui/link-preview";
import { formatTime } from "@/lib/utils/dates";
import { haptics } from "@/lib/haptics";

interface IdeaCardProps {
  idea: Idea;
  onClick?: () => void;
  onStar?: (starred: boolean) => void;
}

const URL_REGEX = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;

function linkify(text: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <a
        key={match.index}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
        style={{ color: "var(--primary, #6366f1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {match[0]}
      </a>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// No src until tap — prevents iOS Safari metadata probe requests from competing with image loads
function InlineVideo({ src }: { src: string }) {
  const [active, setActive] = useState(false);

  if (!active) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setActive(true); }}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        className="w-full rounded-lg flex items-center justify-center"
        style={{ height: 160, backgroundColor: "var(--muted)", border: "none", padding: 0, cursor: "pointer" }}
      >
        <div className="w-11 h-11 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
          <Play size={20} fill="white" strokeWidth={0} style={{ color: "white", marginLeft: 2 }} />
        </div>
      </button>
    );
  }

  return (
    <video
      src={src}
      controls
      playsInline
      autoPlay
      preload="metadata"
      className="w-full rounded-lg"
      style={{ maxHeight: 280, backgroundColor: "#000" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    />
  );
}

export const IdeaCard = memo(function IdeaCard({ idea, onClick, onStar }: IdeaCardProps) {
  const router = useRouter();
  const linkedContent = useMemo(() => linkify(idea.content), [idea.content]);

  const cardBody = (
    <div className="relative w-full text-left px-3.5 py-3">
      {/* Star button */}
      {onStar && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            haptics.tap();
            onStar(!idea.starred);
          }}
          className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-lg"
          style={{ color: idea.starred ? "#facc15" : "var(--muted-foreground)" }}
        >
          <Star
            size={15}
            fill={idea.starred ? "#facc15" : "none"}
            strokeWidth={idea.starred ? 0 : 1.5}
          />
        </button>
      )}

      {idea.content && (
        <p
          className="text-sm leading-relaxed mb-2"
          style={{ color: "var(--foreground)", paddingRight: onStar ? "1.5rem" : 0 }}
        >
          {linkedContent}
        </p>
      )}

      {/* Link preview — YouTube gets its own component, everything else uses microlink */}
      {idea.content && (
        extractYouTubeVideoId(idea.content)
          ? <YouTubePreview content={idea.content} stopPropagation />
          : <LinkPreview content={idea.content} stopPropagation />
      )}

      {idea.has_media && idea.media.length > 0 && (
        <div className="mb-2 space-y-2">
          {idea.media.filter(m => m.media_type === "video").map((m) => (
            <InlineVideo key={m.id} src={m.url} />
          ))}
          {idea.media.filter(m => m.media_type !== "video").length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {idea.media.filter(m => m.media_type !== "video").map((m) =>
                m.media_type === "audio" ? (
                  <div
                    key={m.id}
                    className="h-10 px-3 rounded-lg flex-shrink-0 flex items-center gap-2"
                    style={{ backgroundColor: "var(--muted)" }}
                  >
                    <span className="text-base">🎙️</span>
                    <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>Voice memo</span>
                  </div>
                ) : (
                  <img
                    key={m.id}
                    src={m.url}
                    alt=""
                    loading="lazy"
                    className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
                  />
                )
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end">
        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          {formatTime(idea.timestamp)}
        </span>
      </div>
    </div>
  );

  // Custom onClick (e.g. from SearchResults) — no prefetch needed
  if (onClick) {
    return <GlowCard onClick={onClick}>{cardBody}</GlowCard>;
  }

  // Seed the detail page's SWR cache with this idea so navigation hydrates instantly — no fetch.
  const primeCache = () => {
    globalMutate(`idea-${idea.id}`, idea, false);
  };

  // Default: wrap in Link so Next.js prefetches the route chunk when card enters viewport
  return (
    <Link
      href={`/ideas/${idea.id}`}
      prefetch
      onPointerDown={primeCache}
      onTouchStart={primeCache}
      style={{ display: "block", textDecoration: "none" }}
    >
      <GlowCard>{cardBody}</GlowCard>
    </Link>
  );
});
