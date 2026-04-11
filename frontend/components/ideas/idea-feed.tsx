"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import type { Idea } from "@/lib/types";
import { IdeaCard } from "./idea-card";
import { Flashback } from "./flashback";
import { formatDate } from "@/lib/utils/dates";
import { Skeleton } from "@/components/ui/skeleton";

type ViewMode = "today" | "all";
type MediaFilter = "all" | "text" | "image" | "sketch" | "video";

interface IdeaFeedProps {
  ideas: Idea[];
  isLoading: boolean;
  onRefresh?: () => Promise<unknown>;
  onStar?: (id: number, starred: boolean) => void;
}

const MEDIA_FILTERS: { key: MediaFilter; label: string; icon: string }[] = [
  { key: "all",    label: "All",    icon: "✦" },
  { key: "text",   label: "Text",   icon: "✏️" },
  { key: "image",  label: "Photo",  icon: "🖼" },
  { key: "sketch", label: "Sketch", icon: "✍️" },
  { key: "video",  label: "Video",  icon: "🎥" },
];

const PULL_THRESHOLD = 80;

function getTodayKey() {
  return new Date().toLocaleDateString("en-CA");
}

export function IdeaFeed({ ideas, isLoading, onRefresh, onStar }: IdeaFeedProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("today");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");

  // Pull-to-refresh state
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const pulling = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (refreshing) return;
    // Only activate when scrolled to the top
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    if (scrollTop > 5) return;
    touchStartY.current = e.touches[0].clientY;
    pulling.current = true;
  }, [refreshing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling.current || refreshing) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy < 0) {
      setPullY(0);
      return;
    }
    // Rubber-band effect: diminishing returns past threshold
    const dampened = dy < PULL_THRESHOLD ? dy : PULL_THRESHOLD + (dy - PULL_THRESHOLD) * 0.3;
    setPullY(dampened);
  }, [refreshing]);

  const onTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullY >= PULL_THRESHOLD && onRefresh) {
      setRefreshing(true);
      setPullY(PULL_THRESHOLD);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullY(0);
      }
    } else {
      setPullY(0);
    }
  }, [pullY, onRefresh]);

  const todayKey = getTodayKey();

  const filteredIdeas = useMemo(() => {
    let base = viewMode === "today"
      ? ideas.filter((i) => i.timestamp.startsWith(todayKey))
      : ideas;
    if (mediaFilter !== "all") {
      base = base.filter((i) => i.media_type === mediaFilter);
    }
    return base;
  }, [ideas, viewMode, mediaFilter, todayKey]);

  const grouped = useMemo(() => {
    const groups: { date: string; label: string; ideas: Idea[] }[] = [];
    let currentDate = "";
    for (const idea of filteredIdeas) {
      const dateKey = idea.timestamp.split(" ")[0];
      if (dateKey !== currentDate) {
        currentDate = dateKey;
        groups.push({ date: dateKey, label: formatDate(idea.timestamp), ideas: [] });
      }
      groups[groups.length - 1].ideas.push(idea);
    }
    return groups;
  }, [filteredIdeas]);

  const todayCount = useMemo(
    () => ideas.filter((i) => i.timestamp.startsWith(todayKey)).length,
    [ideas, todayKey]
  );

  if (isLoading) {
    return (
      <div className="space-y-3 pt-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const emptyMessage = viewMode === "today"
    ? "No ideas today yet. Tap + to capture one!"
    : "No ideas yet. Tap + to add one!";

  const progress = Math.min(pullY / PULL_THRESHOLD, 1);

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{
          height: pullY,
          transition: pulling.current ? "none" : "height 0.3s ease",
        }}
      >
        <RefreshCw
          size={20}
          style={{
            color: "var(--muted-foreground)",
            opacity: progress,
            transform: `rotate(${progress * 360}deg)`,
            transition: pulling.current ? "none" : "transform 0.3s ease",
            animation: refreshing ? "spin 0.8s linear infinite" : "none",
          }}
        />
      </div>

      <Flashback ideas={ideas} />

      {/* Row 1: Today / All toggle */}
      <div
        className="flex rounded-xl p-0.5 mb-2"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        <button
          onClick={() => setViewMode("today")}
          className="flex-1 py-2 rounded-lg text-xs font-semibold"
          style={{
            backgroundColor: viewMode === "today" ? "var(--foreground)" : "transparent",
            color: viewMode === "today" ? "var(--background)" : "var(--muted-foreground)",
          }}
        >
          Today{todayCount > 0 && <span className="ml-1 opacity-50">{todayCount}</span>}
        </button>
        <button
          onClick={() => setViewMode("all")}
          className="flex-1 py-2 rounded-lg text-xs font-semibold"
          style={{
            backgroundColor: viewMode === "all" ? "var(--foreground)" : "transparent",
            color: viewMode === "all" ? "var(--background)" : "var(--muted-foreground)",
          }}
        >
          All
        </button>
      </div>

      {/* Row 2: Media type filters */}
      <div
        className="flex rounded-xl p-0.5 mb-3"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        {MEDIA_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setMediaFilter(f.key)}
            className="flex-1 flex flex-col items-center gap-0.5 py-2 rounded-lg"
            style={{
              backgroundColor: mediaFilter === f.key ? "var(--foreground)" : "transparent",
              color: mediaFilter === f.key ? "var(--background)" : "var(--muted-foreground)",
            }}
          >
            <span className="text-sm leading-none">{f.icon}</span>
            <span className="text-[9px] font-semibold leading-none">{f.label}</span>
          </button>
        ))}
      </div>

      {filteredIdeas.length === 0 ? (
        <div className="text-center py-20" style={{ color: "var(--muted-foreground)" }}>
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-1">
          {grouped.map((group, gi) => (
            <div key={group.date}>
              {viewMode === "all" && (
                <div
                  className={`flex items-center gap-3 ${gi > 0 ? "mt-6" : "mt-1"} mb-3`}
                >
                  <span
                    className="text-[11px] font-bold uppercase tracking-widest whitespace-nowrap"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {group.label}
                  </span>
                  <div className="flex-1 h-px" style={{ backgroundColor: "var(--border)" }} />
                  <span
                    className="text-[10px] font-medium flex-shrink-0"
                    style={{ color: "var(--muted-foreground)", opacity: 0.5 }}
                  >
                    {group.ideas.length} {group.ideas.length === 1 ? "idea" : "ideas"}
                  </span>
                </div>
              )}
              <div className="space-y-2">
                {group.ideas.map((idea) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onStar={onStar ? (starred) => onStar(idea.id, starred) : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
