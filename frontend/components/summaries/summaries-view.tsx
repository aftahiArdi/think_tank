"use client";

import { useSyncExternalStore } from "react";
import {
  acquireSummaryLock,
  isSummaryInflight,
  releaseSummaryLock,
  subscribeSummaryLock,
} from "@/lib/summary-lock";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { Sparkles, ChevronRight } from "lucide-react";
import {
  fetchAllDailySummaries,
  fetchDailySummary,
  generateDailySummary,
  type DailySummaryEntry,
} from "@/lib/api";
import { formatDate } from "@/lib/utils/dates";
import { Skeleton } from "@/components/ui/skeleton";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";

function getTodayKey() {
  return new Date().toLocaleDateString("en-CA");
}

function SummaryCard({ entry }: { entry: DailySummaryEntry }) {
  return (
    <Link
      href={`/recap/${entry.date}`}
      onClick={() => haptics.tap()}
      className="block rounded-xl p-3.5 active:opacity-70 transition-opacity"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[11px] font-bold uppercase tracking-widest"
          style={{ color: "var(--muted-foreground)" }}
        >
          {formatDate(`${entry.date} 00:00:00`)}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className="text-[10px] font-medium"
            style={{ color: "var(--muted-foreground)", opacity: 0.6 }}
          >
            {entry.idea_count} {entry.idea_count === 1 ? "idea" : "ideas"}
          </span>
          <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} />
        </div>
      </div>
      <p
        className="text-sm leading-relaxed whitespace-pre-wrap line-clamp-3"
        style={{ color: "var(--foreground)" }}
      >
        {entry.summary}
      </p>
    </Link>
  );
}

function TodayCard() {
  const today = getTodayKey();
  const { data, mutate, isLoading } = useSWR(["daily-summary", today], () =>
    fetchDailySummary(today),
  );
  // Module-level lock keyed by date — survives component re-mounts so tab
  // switches can't let the user fire a second concurrent request.
  const generating = useSyncExternalStore(
    subscribeSummaryLock,
    () => isSummaryInflight(today),
    () => false,
  );

  const run = async (force: boolean) => {
    if (!acquireSummaryLock(today)) return;
    haptics.tap();
    try {
      const result = await generateDailySummary(force, today);
      await mutate(result, { revalidate: false });
      globalMutate("daily-summaries-all").catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Summary failed");
    } finally {
      releaseSummaryLock(today);
    }
  };

  if (isLoading) return <Skeleton className="h-20 w-full rounded-xl" />;

  const hasSummary = !!data?.summary;
  const showLoadingCard = generating;

  return (
    <div className="space-y-2">
      {/* Always-visible action button — lets the user (re)generate today's
          recap without needing to click into the detail page. Label flips to
          "Regenerate" once a summary exists. */}
      <button
        onClick={() => run(hasSummary)}
        disabled={generating}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-semibold active:opacity-60"
        style={{
          backgroundColor: hasSummary ? "var(--card)" : "var(--foreground)",
          color: hasSummary ? "var(--foreground)" : "var(--background)",
          border: hasSummary ? "1px solid var(--border)" : "none",
          opacity: generating ? 0.5 : 1,
        }}
      >
        <Sparkles size={14} />
        {generating
          ? "Summarizing today…"
          : hasSummary
            ? "Regenerate today’s recap"
            : "Generate today’s recap"}
      </button>

      {showLoadingCard && (
        <div
          className="rounded-xl p-3.5"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span
              className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest"
              style={{ color: "var(--muted-foreground)" }}
            >
              <Sparkles
                size={11}
                style={{ animation: "pulse 1.2s ease-in-out infinite" }}
              />
              {hasSummary ? "Regenerating…" : "Summarizing today…"}
            </span>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-full rounded" />
            <Skeleton className="h-3 w-[92%] rounded" />
            <Skeleton className="h-3 w-[78%] rounded" />
          </div>
        </div>
      )}

      {!showLoadingCard && hasSummary && (
        <SummaryCard
          entry={{
            date: today,
            summary: data.summary!,
            idea_count: data.idea_count ?? 0,
            created_at: data.created_at ?? "",
          }}
        />
      )}
    </div>
  );
}

export function SummariesView() {
  const { data, isLoading } = useSWR("daily-summaries-all", () => fetchAllDailySummaries());
  const summaries = data?.summaries ?? [];
  const today = getTodayKey();
  const pastSummaries = summaries.filter((s) => s.date !== today);

  return (
    <div className="space-y-3 pt-2 pb-4">
      <TodayCard />

      {isLoading && (
        <>
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </>
      )}

      {!isLoading && pastSummaries.length === 0 && (
        <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>
          <Sparkles size={24} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No past summaries yet.</p>
        </div>
      )}

      {pastSummaries.map((s) => (
        <SummaryCard key={s.date} entry={s} />
      ))}
    </div>
  );
}
