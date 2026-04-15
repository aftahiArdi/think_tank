"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import useSWR from "swr";
import { fetchDailySummary, generateDailySummary, type DailySummary } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";

interface DailySummaryCardProps {
  /** Number of ideas today — used to gate the button (nothing to summarize if 0). */
  todayCount: number;
}

export function DailySummaryCard({ todayCount }: DailySummaryCardProps) {
  const { data, mutate, isLoading } = useSWR<DailySummary>(
    "daily-summary-today",
    () => fetchDailySummary(),
  );
  const [generating, setGenerating] = useState(false);

  const summary = data?.summary ?? null;

  const run = async (force: boolean) => {
    if (generating) return;
    haptics.tap();
    setGenerating(true);
    try {
      const result = await generateDailySummary(force);
      await mutate(result, { revalidate: false });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Summary failed");
    } finally {
      setGenerating(false);
    }
  };

  if (todayCount === 0) return null;

  if (!summary && !isLoading) {
    return (
      <button
        onClick={() => run(false)}
        disabled={generating}
        className="w-full mb-3 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--foreground)",
          opacity: generating ? 0.6 : 1,
        }}
      >
        <Sparkles size={14} />
        {generating ? "Summarizing today…" : "Summarize today"}
      </button>
    );
  }

  if (!summary) return null;

  return (
    <div
      className="mb-3 rounded-xl p-3.5"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--muted-foreground)" }}
        >
          <Sparkles size={11} />
          Today in summary
        </div>
        <button
          onClick={() => run(true)}
          disabled={generating}
          aria-label="Regenerate"
          className="p-1 rounded-md active:opacity-60"
          style={{ color: "var(--muted-foreground)" }}
        >
          <RefreshCw
            size={12}
            style={{ animation: generating ? "spin 0.8s linear infinite" : "none" }}
          />
        </button>
      </div>
      <p
        className="text-sm leading-relaxed whitespace-pre-wrap"
        style={{ color: "var(--foreground)" }}
      >
        {summary}
      </p>
    </div>
  );
}
