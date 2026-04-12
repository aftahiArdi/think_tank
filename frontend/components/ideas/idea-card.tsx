"use client";

import { memo, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Star } from "lucide-react";
import type { Idea } from "@/lib/types";
import { GlowCard } from "@/components/ui/glow-card";
import { formatTime } from "@/lib/utils/dates";

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

      {idea.has_media && idea.media.length > 0 && (
        <div className="flex gap-2 mb-2 overflow-x-auto">
          {idea.media.map((m) =>
            m.media_type === "video" ? (
              <div
                key={m.id}
                className="w-20 h-20 rounded-lg flex-shrink-0 flex items-center justify-center text-2xl"
                style={{ backgroundColor: "var(--muted)" }}
              >
                🎥
              </div>
            ) : m.media_type === "audio" ? (
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

  // Default: wrap in Link so Next.js prefetches the route chunk when card enters viewport
  return (
    <Link href={`/ideas/${idea.id}`} prefetch style={{ display: "block", textDecoration: "none" }}>
      <GlowCard>{cardBody}</GlowCard>
    </Link>
  );
});
