"use client";

import { useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Shuffle, ChevronLeft, ChevronRight } from "lucide-react";
import type { Idea } from "@/lib/types";

interface FlashbackProps {
  ideas: Idea[];
}

function timeAgoLabel(dateStr: string): string {
  const then = new Date(dateStr.replace(" ", "T"));
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 7) return `${days} day${days !== 1 ? "s" : ""} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks !== 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months !== 1 ? "s" : ""} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years !== 1 ? "s" : ""} ago`;
}

function getFlashbackIdeas(ideas: Idea[]): Idea[] {
  const now = new Date();
  const todayKey = now.toLocaleDateString("en-CA");
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // Collect one random idea from each past week (same day of week)
  // e.g. if today is Sunday, find ideas from last Sunday, 2 Sundays ago, etc.
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const results: Idea[] = [];

  for (let weeksAgo = 1; weeksAgo <= 52; weeksAgo++) {
    const targetStart = todayStart - weeksAgo * weekMs;
    const targetEnd = targetStart + 24 * 60 * 60 * 1000;

    const matches = ideas.filter((idea) => {
      const t = new Date(idea.timestamp.replace(" ", "T")).getTime();
      return t >= targetStart && t < targetEnd;
    });

    if (matches.length > 0) {
      // Pick a random one from that day
      results.push(matches[Math.floor(Math.random() * matches.length)]);
    }
  }

  // Also include exact month+day matches from older than a week
  const month = now.getMonth();
  const day = now.getDate();
  for (const idea of ideas) {
    const d = new Date(idea.timestamp.replace(" ", "T"));
    const ideaDate = d.toLocaleDateString("en-CA");
    if (d.getMonth() === month && d.getDate() === day && ideaDate !== todayKey) {
      if (!results.find((r) => r.id === idea.id)) {
        results.push(idea);
      }
    }
  }

  return results;
}

function IdeaPreview({ idea, label }: { idea: Idea; label: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(`/ideas/${idea.id}`)}
      className="w-full text-left"
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
        style={{ color: "var(--muted-foreground)", opacity: 0.6 }}
      >
        {label}
      </p>
      <p
        className="text-sm leading-relaxed line-clamp-3"
        style={{ color: "var(--foreground)" }}
      >
        {idea.content || (idea.has_media ? "Photo / media" : "Empty idea")}
      </p>
      {idea.has_media && idea.media.length > 0 && idea.media[0].media_type !== "video" && (
        <img
          src={idea.media[0].url}
          alt=""
          className="w-full h-32 rounded-lg object-cover mt-2"
        />
      )}
    </button>
  );
}

export function Flashback({ ideas }: FlashbackProps) {
  const [randomIdea, setRandomIdea] = useState<Idea | null>(null);
  const [flashbackIndex, setOnThisDayIndex] = useState(0);

  const flashbackIdeas = useMemo(() => getFlashbackIdeas(ideas), [ideas]);

  // Only consider ideas older than 24h for random
  const olderIdeas = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return ideas.filter(
      (i) => new Date(i.timestamp.replace(" ", "T")).getTime() < cutoff
    );
  }, [ideas]);

  const shuffle = useCallback(() => {
    if (olderIdeas.length === 0) return;
    const idx = Math.floor(Math.random() * olderIdeas.length);
    setRandomIdea(olderIdeas[idx]);
  }, [olderIdeas]);

  const hasFlashbacks = flashbackIdeas.length > 0;
  const currentFlashback = flashbackIdeas[flashbackIndex];

  if (olderIdeas.length < 5 && !hasFlashbacks) return null;

  return (
    <div className="space-y-3 mb-4">
      {/* On This Day */}
      {hasFlashbacks && currentFlashback && (
        <div
          className="rounded-2xl px-4 py-3.5"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <IdeaPreview
            idea={currentFlashback}
            label={`Flashback \u00B7 ${timeAgoLabel(currentFlashback.timestamp)}`}
          />
          {flashbackIdeas.length > 1 && (
            <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
              <button
                onClick={() =>
                  setOnThisDayIndex((i) => (i - 1 + flashbackIdeas.length) % flashbackIdeas.length)
                }
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: "var(--muted)" }}
              >
                <ChevronLeft size={14} style={{ color: "var(--muted-foreground)" }} />
              </button>
              <span className="text-[10px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                {flashbackIndex + 1} of {flashbackIdeas.length}
              </span>
              <button
                onClick={() =>
                  setOnThisDayIndex((i) => (i + 1) % flashbackIdeas.length)
                }
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: "var(--muted)" }}
              >
                <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Random idea */}
      {olderIdeas.length >= 5 && (
        <div
          className="rounded-2xl px-4 py-3.5"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          {randomIdea ? (
            <>
              <IdeaPreview
                idea={randomIdea}
                label={`Random \u00B7 ${timeAgoLabel(randomIdea.timestamp)}`}
              />
              <button
                onClick={shuffle}
                className="flex items-center gap-1.5 mt-3 pt-2 w-full justify-center"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <Shuffle size={13} style={{ color: "var(--muted-foreground)" }} />
                <span className="text-[11px] font-semibold" style={{ color: "var(--muted-foreground)" }}>
                  Another one
                </span>
              </button>
            </>
          ) : (
            <button
              onClick={shuffle}
              className="flex items-center justify-center gap-2 w-full py-2"
            >
              <Shuffle size={16} style={{ color: "var(--muted-foreground)" }} />
              <span className="text-sm font-medium" style={{ color: "var(--muted-foreground)" }}>
                Resurface a random idea
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
