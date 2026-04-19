"use client";

import { colorForValue } from "@/lib/mood";

interface MoodAverageProps {
  average: number | null;
  averageLabel: string | null;
  days: number;
  count: number;
}

export function MoodAverage({ average, averageLabel, days, count }: MoodAverageProps) {
  if (average === null || averageLabel === null) {
    return null;
  }

  const color = colorForValue(average);

  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
    >
      <p
        className="text-[10px] uppercase tracking-wider mb-1"
        style={{ color: "var(--muted-foreground)" }}
      >
        Last {days} days
      </p>
      <p className="text-2xl font-semibold tracking-tight" style={{ color }}>
        {averageLabel}
      </p>
      <p className="text-[10px] mt-1" style={{ color: "var(--muted-foreground)" }}>
        {count} {count === 1 ? "check-in" : "check-ins"} · avg {average.toFixed(1)}/7
      </p>
    </div>
  );
}
