"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import type { Idea } from "@/lib/types";
import { IdeaCard } from "./idea-card";
import { Flashback } from "./flashback";
import { formatDate } from "@/lib/utils/dates";
import { Skeleton } from "@/components/ui/skeleton";
import { haptics } from "@/lib/haptics";

type ViewMode = "today" | "all";
type MediaFilter = "all" | "text" | "image" | "sketch" | "video" | "audio";

interface IdeaFeedProps {
  ideas: Idea[];
  isLoading: boolean;
  onRefresh?: () => Promise<unknown>;
  onStar?: (id: number, starred: boolean) => void;
  onLoadMore?: () => Promise<unknown> | void;
  hasMore?: boolean;
}

const MEDIA_FILTERS: { key: MediaFilter; label: string; icon: string }[] = [
  { key: "all",    label: "All",    icon: "✦" },
  { key: "text",   label: "Text",   icon: "✏️" },
  { key: "image",  label: "Photo",  icon: "🖼" },
  { key: "sketch", label: "Sketch", icon: "✍️" },
  { key: "video",  label: "Video",  icon: "🎥" },
  { key: "audio",  label: "Voice",  icon: "🎙️" },
];

// Threshold lowered from 80 → 55: less wrist travel to trigger a refresh,
// matches the "flick" feel of native iOS Mail / Twitter PTR better.
const PULL_THRESHOLD = 55;
// Release easing — slight overshoot bounce when the indicator snaps back home.
const RELEASE_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const INITIAL_VISIBLE = 30;
const PAGE_SIZE = 30;

function getTodayKey() {
  return new Date().toLocaleDateString("en-CA");
}

export function IdeaFeed({ ideas, isLoading, onRefresh, onStar, onLoadMore, hasMore: serverHasMore }: IdeaFeedProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("today");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");

  // Progressive rendering — cap how many cards are in the DOM at once.
  // Without this, users with long histories mount 800+ cards on every feed load,
  // which destroys iPhone Safari first-paint time and scroll performance.
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Pull-to-refresh: native non-passive listener + direct DOM writes.
  //
  // React 19's synthetic touch events attach as passive listeners, so
  // `e.preventDefault()` is silently ignored — meaning iOS rubber-bands the
  // whole page and our custom pull fights the native scroll. The fix is to
  // attach the touchmove listener ourselves with `{ passive: false }`, then
  // drive the spacer height via `.style.height` on refs instead of setState.
  // Zero re-renders during the drag.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const iconRef = useRef<SVGSVGElement | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    let startY = 0;
    let lastDampened = 0;
    let pulling = false;
    let crossed = false;

    const writeIndicator = (y: number) => {
      const indicator = indicatorRef.current;
      const icon = iconRef.current;
      // progress hits 1.0 exactly at the trigger threshold.
      const progress = Math.min(y / PULL_THRESHOLD, 1);
      // Snap the icon slightly larger once the user crosses the trigger — it's
      // the visual counterpart to the haptic tap: "let go now and it refreshes".
      const armed = progress >= 1;
      const scale = armed ? 1.15 : 0.6 + progress * 0.55;
      // Rotate up to ~200° by threshold (feels lively without spinning twice)
      // and then hold steady so the armed state is obviously settled.
      const rot = armed ? 200 : progress * 200;
      if (indicator) {
        indicator.style.height = `${y}px`;
        indicator.style.transition = pulling
          ? "none"
          : `height 0.42s ${RELEASE_EASE}`;
      }
      if (icon) {
        icon.style.opacity = String(Math.min(progress * 1.2, 1));
        icon.style.transform = `rotate(${rot}deg) scale(${scale})`;
        icon.style.transition = pulling
          ? "transform 0.12s ease-out"
          : `transform 0.42s ${RELEASE_EASE}, opacity 0.2s ease`;
      }
    };

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      if (scrollTop > 5) return;
      startY = e.touches[0].clientY;
      pulling = true;
      crossed = false;
      lastDampened = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!pulling || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        // User is scrolling up — abandon the pull and let native handle it.
        pulling = false;
        writeIndicator(0);
        return;
      }
      // We own this gesture: block the native rubber-band so the page doesn't
      // drift while we animate the indicator.
      if (e.cancelable) e.preventDefault();
      const dampened = dy < PULL_THRESHOLD ? dy : PULL_THRESHOLD + (dy - PULL_THRESHOLD) * 0.3;
      lastDampened = dampened;
      if (!crossed && dampened >= PULL_THRESHOLD) {
        crossed = true;
        haptics.tap();
      } else if (crossed && dampened < PULL_THRESHOLD) {
        crossed = false;
      }
      writeIndicator(dampened);
    };

    const onEnd = async () => {
      if (!pulling) return;
      pulling = false;
      const shouldRefresh = lastDampened >= PULL_THRESHOLD;
      crossed = false;
      if (shouldRefresh && onRefreshRef.current) {
        refreshingRef.current = true;
        setRefreshing(true);
        writeIndicator(PULL_THRESHOLD);
        try {
          await onRefreshRef.current();
        } finally {
          refreshingRef.current = false;
          setRefreshing(false);
          writeIndicator(0);
        }
      } else {
        writeIndicator(0);
      }
    };

    // `passive: false` is the critical bit — without it preventDefault is ignored.
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

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

  // Reset visible window whenever the filter set changes so the user lands at the top
  // with a fresh page — otherwise they'd get a stale count against a different list.
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [viewMode, mediaFilter]);

  const visibleIdeas = useMemo(
    () => filteredIdeas.slice(0, visibleCount),
    [filteredIdeas, visibleCount]
  );
  // hasMore is true if either: (a) we have in-memory ideas not yet rendered to the DOM, or
  // (b) the server has older pages we haven't fetched yet.
  const hasMoreInMemory = filteredIdeas.length > visibleIdeas.length;
  const hasMore = hasMoreInMemory || !!serverHasMore;

  // IntersectionObserver sentinel — either bumps the in-DOM window, or fetches the next
  // server page once the window has caught up. rootMargin "600px" starts loading before
  // the sentinel is actually visible so the user never sees a gap.
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (hasMoreInMemory) {
          setVisibleCount((c) => c + PAGE_SIZE);
        } else if (onLoadMore) {
          void onLoadMore();
        }
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, hasMoreInMemory, visibleIdeas.length, onLoadMore]);

  const grouped = useMemo(() => {
    const groups: { date: string; label: string; ideas: Idea[] }[] = [];
    let currentDate = "";
    for (const idea of visibleIdeas) {
      const dateKey = idea.timestamp.split(" ")[0];
      if (dateKey !== currentDate) {
        currentDate = dateKey;
        groups.push({ date: dateKey, label: formatDate(idea.timestamp), ideas: [] });
      }
      groups[groups.length - 1].ideas.push(idea);
    }
    return groups;
  }, [visibleIdeas]);

  const todayCount = useMemo(
    () => ideas.filter((i) => i.timestamp.startsWith(todayKey)).length,
    [ideas, todayKey]
  );

  const emptyMessage = viewMode === "today"
    ? "No ideas today yet. Tap + to capture one!"
    : "No ideas yet. Tap + to add one!";

  // Skeleton renders inside the same ref'd root so the pull-to-refresh native
  // listener (attached in useEffect on mount) always has an element to bind to.
  // Previously the skeleton branch returned its own div without the ref, so on
  // initial load the listener never attached until the user left and returned
  // to the tab.
  if (isLoading) {
    return (
      <div ref={rootRef} style={{ touchAction: "pan-y" }}>
        <div className="space-y-3 pt-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ touchAction: "pan-y" }}>
      {/* Pull-to-refresh indicator — height + rotation driven via refs from the
          native touch listener, so dragging doesn't re-render the whole feed. */}
      <div
        ref={indicatorRef}
        className="flex items-center justify-center overflow-hidden"
        style={{ height: 0 }}
      >
        <RefreshCw
          ref={iconRef}
          size={22}
          style={{
            color: "var(--foreground)",
            opacity: 0,
            willChange: "transform, opacity",
            // While refreshing, ptr-spin keyframes keep scale(1.15) so the icon
            // doesn't shrink mid-animation.
            animation: refreshing ? "ptr-spin 0.8s linear infinite" : "none",
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
          {hasMore && (
            <div
              ref={sentinelRef}
              className="py-6 text-center text-xs"
              style={{ color: "var(--muted-foreground)" }}
            >
              Loading more…
            </div>
          )}
        </div>
      )}

      <style jsx global>{`
        @keyframes ptr-spin {
          from { transform: rotate(0deg) scale(1.15); }
          to   { transform: rotate(360deg) scale(1.15); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
