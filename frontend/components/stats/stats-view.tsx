"use client";

import { useMemo, useRef, useEffect } from "react";
import useSWR from "swr";
import type { Idea } from "@/lib/types";
import { fetchStatsData } from "@/lib/api";
import { useMoods } from "@/lib/hooks/use-moods";
import { MoodGraph } from "@/components/mood/mood-graph";
import { MoodAverage } from "@/components/mood/mood-average";

interface StatsViewProps {
  // Kept for API compatibility with existing callers. Stats now fetch their own
  // dataset server-side so they cover every idea, not just the first paginated page.
  ideas?: Idea[];
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Display order Mon–Sun for day×hour grid
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function formatHour(h: number): string {
  const start = h % 12 || 12;
  const end = (h + 1) % 12 || 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${start}–${end} ${ampm}`;
}

function formatMonthKey(key: string): { month: string; year: string } {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1);
  return {
    month: d.toLocaleDateString("en-US", { month: "long" }),
    year: String(y),
  };
}

function getWeekStart(d: Date): Date {
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

const HEATMAP_COLOURS = ["#1e1e1e", "#14532d", "#166534", "#4ade80"];

function heatColour(count: number): string {
  if (count === 0) return HEATMAP_COLOURS[0];
  if (count <= 2) return HEATMAP_COLOURS[1];
  if (count <= 5) return HEATMAP_COLOURS[2];
  return HEATMAP_COLOURS[3];
}

function tsToMs(ts: string): number {
  const [date, time] = ts.split(" ");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, s] = (time || "0:0:0").split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

function computeStats(ideas: Idea[]) {
  if (ideas.length === 0) return null;

  const dateMap = new Map<string, number>();
  const monthMap = new Map<string, number>();
  const dayOfWeekMap = new Map<number, number>();
  const hourMap = new Map<number, number>();
  const dayHourMap = new Map<string, number>();
  const typeMap = new Map<string, number>();
  let totalWords = 0;

  for (const idea of ideas) {
    const datePart = idea.timestamp.split(" ")[0];
    const timePart = idea.timestamp.split(" ")[1] || "0:0:0";
    const [iy, im, id] = datePart.split("-").map(Number);
    const hour = parseInt(timePart.split(":")[0]);
    const localDate = new Date(iy, im - 1, id);
    const dow = localDate.getDay();
    const dhKey = `${dow}-${hour}`;

    dateMap.set(datePart, (dateMap.get(datePart) || 0) + 1);
    monthMap.set(datePart.slice(0, 7), (monthMap.get(datePart.slice(0, 7)) || 0) + 1);
    dayOfWeekMap.set(dow, (dayOfWeekMap.get(dow) || 0) + 1);
    hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
    dayHourMap.set(dhKey, (dayHourMap.get(dhKey) || 0) + 1);
    typeMap.set(idea.media_type, (typeMap.get(idea.media_type) || 0) + 1);

    if (idea.content.trim()) {
      totalWords += idea.content.trim().split(/\s+/).filter(Boolean).length;
    }
  }

  // Burst sessions: 3+ ideas within 30 minutes
  const sorted = [...ideas].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  let burstSessions = 0;
  let maxBurst = 0;
  let totalBurstIdeas = 0;
  let sessionStart = 0;
  for (let i = 1; i <= sorted.length; i++) {
    const isEnd = i === sorted.length;
    const gapMins = isEnd
      ? Infinity
      : (tsToMs(sorted[i].timestamp) - tsToMs(sorted[i - 1].timestamp)) / 60000;
    if (isEnd || gapMins > 30) {
      const len = i - sessionStart;
      if (len >= 3) {
        burstSessions++;
        totalBurstIdeas += len;
        maxBurst = Math.max(maxBurst, len);
      }
      sessionStart = i;
    }
  }
  const avgBurstSize = burstSessions > 0 ? (totalBurstIdeas / burstSessions).toFixed(1) : "0";

  // Day × hour grid max (for colour scaling)
  const dayHourMax = Math.max(1, ...Array.from(dayHourMap.values()));

  // Current streak
  let currentStreak = 0;
  const streakDate = new Date();
  const todayStr = streakDate.toLocaleDateString("en-CA");
  if (!dateMap.has(todayStr)) streakDate.setDate(streakDate.getDate() - 1);
  while (dateMap.has(streakDate.toLocaleDateString("en-CA"))) {
    currentStreak++;
    streakDate.setDate(streakDate.getDate() - 1);
  }

  // Longest streak
  let longestStreak = 0;
  let tempStreak = 0;
  let prevDate: Date | null = null;
  for (const ds of Array.from(dateMap.keys()).sort()) {
    const [y, m, d] = ds.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (prevDate === null) {
      tempStreak = 1;
    } else {
      const diff = Math.round((date.getTime() - prevDate.getTime()) / 86400000);
      tempStreak = diff === 1 ? tempStreak + 1 : 1;
    }
    longestStreak = Math.max(longestStreak, tempStreak);
    prevDate = date;
  }

  // Since date
  const oldestTs = [...ideas].sort((a, b) => a.timestamp.localeCompare(b.timestamp))[0].timestamp;
  const [oy, om, od] = oldestTs.split(" ")[0].split("-").map(Number);
  const oldestDate = new Date(oy, om - 1, od);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSinceFirst = Math.max(1, Math.round((today.getTime() - oldestDate.getTime()) / 86400000));
  const sinceStr = oldestDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // This week / last week
  const thisWeekStart = getWeekStart(new Date());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  let thisWeekCount = 0;
  let lastWeekCount = 0;
  for (const idea of ideas) {
    const [iy, im, id] = idea.timestamp.split(" ")[0].split("-").map(Number);
    const d = new Date(iy, im - 1, id);
    if (d >= thisWeekStart) thisWeekCount++;
    else if (d >= lastWeekStart) lastWeekCount++;
  }

  // Best month
  let bestMonth = { key: "", count: 0 };
  for (const [key, count] of monthMap) {
    if (count > bestMonth.count) bestMonth = { key, count };
  }

  // Most active day
  let bestDayEntry = { day: 1, count: 0 };
  for (const [day, count] of dayOfWeekMap) {
    if (count > bestDayEntry.count) bestDayEntry = { day, count };
  }

  // Peak hour
  let bestHourEntry = { hour: 21, count: 0 };
  for (const [hour, count] of hourMap) {
    if (count > bestHourEntry.count) bestHourEntry = { hour, count };
  }

  // Type breakdown
  const typeConfig = [
    { key: "text",   label: "Text",   color: "#4ade80" },
    { key: "image",  label: "Photo",  color: "#60a5fa" },
    { key: "sketch", label: "Sketch", color: "#a78bfa" },
    { key: "video",  label: "Video",  color: "#fb923c" },
    { key: "audio",  label: "Voice",  color: "#f472b6" },
  ];
  const typeBreakdown = typeConfig
    .map(t => ({ ...t, count: typeMap.get(t.key) || 0 }))
    .filter(t => t.count > 0)
    .map(t => ({ ...t, pct: Math.round((t.count / ideas.length) * 100) }));

  // Heatmap: 26 weeks ending today
  const thisMonday = getWeekStart(new Date());
  const heatStart = new Date(thisMonday);
  heatStart.setDate(thisMonday.getDate() - 25 * 7);
  const heatmapWeeks: { date: string; count: number; future: boolean }[][] = [];
  const nowStr = new Date().toLocaleDateString("en-CA");
  for (let w = 0; w < 26; w++) {
    const week: { date: string; count: number; future: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const cell = new Date(heatStart);
      cell.setDate(heatStart.getDate() + w * 7 + d);
      const ds = cell.toLocaleDateString("en-CA");
      week.push({ date: ds, count: dateMap.get(ds) || 0, future: ds > nowStr });
    }
    heatmapWeeks.push(week);
  }

  const bestMonthFormatted = bestMonth.key ? formatMonthKey(bestMonth.key) : null;

  return {
    total: ideas.length,
    sinceStr,
    currentStreak,
    longestStreak,
    avgPerDay: (ideas.length / daysSinceFirst).toFixed(1),
    activeDays: dateMap.size,
    thisWeekCount,
    lastWeekCount,
    totalWords,
    typeBreakdown,
    bestDay: DAY_NAMES[bestDayEntry.day],
    peakHour: formatHour(bestHourEntry.hour),
    bestMonth: bestMonthFormatted,
    bestMonthCount: bestMonth.count,
    heatmapWeeks,
    burstSessions,
    maxBurst,
    avgBurstSize,
    dayHourMap,
    dayHourMax,
  };
}

function dayHourColour(count: number, max: number): string {
  if (count === 0) return HEATMAP_COLOURS[0];
  const ratio = count / max;
  if (ratio < 0.25) return HEATMAP_COLOURS[1];
  if (ratio < 0.6) return HEATMAP_COLOURS[2];
  return HEATMAP_COLOURS[3];
}

function DayHourHeatmap({ dayHourMap, dayHourMax }: { dayHourMap: Map<string, number>; dayHourMax: number }) {
  // 7 rows (Mon–Sun) × 24 cols (0–23)
  const HOUR_LABELS: { h: number; label: string }[] = [
    { h: 0, label: "12a" }, { h: 6, label: "6a" }, { h: 12, label: "12p" }, { h: 18, label: "6p" },
  ];
  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"] }}>
      <div style={{ display: "inline-flex", gap: 0 }}>
        {/* Day labels column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: 4, paddingTop: 0 }}>
          {WEEK_ORDER.map(dow => (
            <div
              key={dow}
              style={{
                height: 10,
                lineHeight: "10px",
                fontSize: 8,
                color: "var(--muted-foreground)",
                whiteSpace: "nowrap",
                textAlign: "right",
                paddingRight: 2,
              }}
            >
              {DAY_SHORT[dow]}
            </div>
          ))}
        </div>
        {/* Grid */}
        <div>
          <div style={{ display: "flex", flexDirection: "row", gap: 2 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {WEEK_ORDER.map(dow => {
                  const count = dayHourMap.get(`${dow}-${h}`) || 0;
                  return (
                    <div
                      key={dow}
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        backgroundColor: dayHourColour(count, dayHourMax),
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          {/* Hour labels */}
          <div style={{ position: "relative", height: 12, marginTop: 3 }}>
            {HOUR_LABELS.map(({ h, label }) => (
              <span
                key={h}
                style={{
                  position: "absolute",
                  left: h * 12,
                  fontSize: 8,
                  color: "var(--muted-foreground)",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div
      className="rounded-xl p-3 text-center"
      style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
    >
      <p
        className="text-xl font-bold tabular-nums leading-none"
        style={{ color: accent ? "var(--primary)" : "var(--foreground)" }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[9px] mt-1 leading-tight" style={{ color: "var(--muted-foreground)" }}>
          {sub}
        </p>
      )}
      <p className="text-[9px] mt-0.5 uppercase tracking-wider leading-tight" style={{ color: "var(--muted-foreground)" }}>
        {label}
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-[11px] uppercase tracking-wider mb-2.5" style={{ color: "var(--muted-foreground)" }}>
      {children}
    </p>
  );
}

const MOOD_DAYS = 30;

export function StatsView(_props: StatsViewProps) {
  const { data, isLoading } = useSWR("stats-data", () => fetchStatsData(), {
    revalidateOnFocus: false,
  });
  const allIdeas = data?.ideas ?? [];
  const stats = useMemo(() => computeStats(allIdeas), [allIdeas]);
  const heatmapRef = useRef<HTMLDivElement>(null);

  const { data: moodData } = useMoods(MOOD_DAYS);
  const moods = moodData?.moods ?? [];
  const moodAverage = moodData?.average ?? null;
  const moodAverageLabel = moodData?.average_label ?? null;

  useEffect(() => {
    if (heatmapRef.current) {
      heatmapRef.current.scrollLeft = heatmapRef.current.scrollWidth;
    }
  }, [stats]);

  if (isLoading && !stats) {
    return (
      <div className="pt-16 text-center" style={{ color: "var(--muted-foreground)" }}>
        <p className="text-sm">Loading stats…</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="pt-16 text-center" style={{ color: "var(--muted-foreground)" }}>
        <p className="text-sm">No ideas yet.</p>
        <p className="text-xs mt-1">Tap + to capture your first one.</p>
      </div>
    );
  }

  const weekDiff = stats.thisWeekCount - stats.lastWeekCount;

  return (
    <div className="space-y-6 pt-2 pb-4">

      {/* Hero */}
      <div className="text-center py-4">
        <p
          className="text-6xl font-black tabular-nums leading-none tracking-tight"
          style={{ color: "var(--foreground)" }}
        >
          {stats.total.toLocaleString()}
        </p>
        <p className="text-[11px] uppercase tracking-widest mt-2" style={{ color: "var(--muted-foreground)" }}>
          ideas captured
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)", opacity: 0.5 }}>
          since {stats.sinceStr}
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="streak" value={stats.currentStreak} sub="days" accent />
        <StatCard label="avg / day" value={stats.avgPerDay} />
        <StatCard label="active days" value={stats.activeDays} />
      </div>

      {/* Mood */}
      <div>
        <SectionLabel>Mood</SectionLabel>
        <div className="space-y-2">
          <MoodAverage
            average={moodAverage}
            averageLabel={moodAverageLabel}
            days={MOOD_DAYS}
            count={moods.length}
          />
          <MoodGraph moods={moods} days={MOOD_DAYS} />
        </div>
      </div>

      {/* This week vs last week */}
      <div>
        <SectionLabel>This week vs last</SectionLabel>
        <div
          className="rounded-xl p-4"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold tabular-nums" style={{ color: "var(--foreground)" }}>
                {stats.thisWeekCount}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>this week</p>
            </div>
            <div
              className="px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                backgroundColor: weekDiff >= 0 ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.06)",
                color: weekDiff >= 0 ? "#4ade80" : "var(--muted-foreground)",
              }}
            >
              {weekDiff >= 0 ? "+" : ""}{weekDiff} vs last week
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold tabular-nums" style={{ color: "var(--muted-foreground)", opacity: 0.4 }}>
                {stats.lastWeekCount}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>last week</p>
            </div>
          </div>
        </div>
      </div>

      {/* Burst sessions */}
      {stats.burstSessions > 0 && (
        <div>
          <SectionLabel>Burst sessions</SectionLabel>
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <p className="text-3xl font-bold tabular-nums" style={{ color: "var(--foreground)" }}>
              {stats.burstSessions}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
              times you captured 3+ ideas in 30 min
            </p>
            <div className="flex gap-4 mt-3">
              <div>
                <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--foreground)" }}>
                  {stats.avgBurstSize}
                </p>
                <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>avg per burst</p>
              </div>
              <div>
                <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--foreground)" }}>
                  {stats.maxBurst}
                </p>
                <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>record burst</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Words captured */}
      <div>
        <SectionLabel>Words captured</SectionLabel>
        <div
          className="rounded-xl p-4"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <p className="text-3xl font-bold tabular-nums" style={{ color: "var(--foreground)" }}>
            {stats.totalWords.toLocaleString()}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
            words of thought captured
          </p>
        </div>
      </div>

      {/* Activity heatmap */}
      <div>
        <SectionLabel>Activity — past 6 months</SectionLabel>
        <div
          ref={heatmapRef}
          className="overflow-x-auto rounded-xl p-3"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
          }}
        >
          <div className="flex gap-[3px]" style={{ width: "max-content" }}>
            {stats.heatmapWeeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((cell, di) => (
                  <div
                    key={di}
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      backgroundColor: cell.future ? "transparent" : heatColour(cell.count),
                      opacity: cell.future ? 0 : 1,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-1 mt-2">
            <span className="text-[9px]" style={{ color: "var(--muted-foreground)" }}>less</span>
            {HEATMAP_COLOURS.map(c => (
              <div key={c} style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: c }} />
            ))}
            <span className="text-[9px]" style={{ color: "var(--muted-foreground)" }}>more</span>
          </div>
        </div>
      </div>

      {/* Day × hour heatmap */}
      <div>
        <SectionLabel>When you think</SectionLabel>
        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <DayHourHeatmap dayHourMap={stats.dayHourMap} dayHourMax={stats.dayHourMax} />
        </div>
      </div>

      {/* Type breakdown */}
      <div>
        <SectionLabel>By type</SectionLabel>
        <div
          className="rounded-xl p-4 space-y-3"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          {stats.typeBreakdown.map(t => (
            <div key={t.key}>
              <div className="flex justify-between mb-1">
                <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>{t.label}</span>
                <span className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
                  {t.count.toLocaleString()} · {t.pct}%
                </span>
              </div>
              <div className="h-1 rounded-full" style={{ backgroundColor: "var(--muted)" }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${t.pct}%`, backgroundColor: t.color }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Patterns */}
      <div>
        <SectionLabel>Patterns</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <div
            className="rounded-xl p-3"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <p className="text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>Most active day</p>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{stats.bestDay}</p>
          </div>
          <div
            className="rounded-xl p-3"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <p className="text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>Peak hour</p>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{stats.peakHour}</p>
          </div>
          {stats.bestMonth && (
            <div
              className="rounded-xl p-3"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <p className="text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>Best month</p>
              <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{stats.bestMonth.month}</p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                {stats.bestMonthCount} ideas · {stats.bestMonth.year}
              </p>
            </div>
          )}
          <div
            className="rounded-xl p-3"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <p className="text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>Longest streak</p>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{stats.longestStreak} days</p>
          </div>
        </div>
      </div>

    </div>
  );
}
