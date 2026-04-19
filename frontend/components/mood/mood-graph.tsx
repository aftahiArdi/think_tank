"use client";

import { useMemo } from "react";
import type { Mood } from "@/lib/types";
import { MOOD_COLORS, colorForValue } from "@/lib/mood";

interface MoodGraphProps {
  moods: Mood[];
  days: number;
}

const WIDTH = 320;
const HEIGHT = 140;
const PADDING_X = 14;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 18;

function tsToMs(ts: string): number {
  const [date, time] = ts.split(" ");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, s] = (time || "0:0:0").split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

export function MoodGraph({ moods, days }: MoodGraphProps) {
  const { points, segments, xTicks } = useMemo(() => {
    const now = Date.now();
    const startMs = now - days * 24 * 60 * 60 * 1000;
    const sorted = [...moods]
      .map((m) => ({ ...m, ms: tsToMs(m.timestamp) }))
      .filter((m) => m.ms >= startMs)
      .sort((a, b) => a.ms - b.ms);

    const range = Math.max(1, now - startMs);
    const innerW = WIDTH - PADDING_X * 2;
    const innerH = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

    const pts = sorted.map((m) => {
      const x = PADDING_X + ((m.ms - startMs) / range) * innerW;
      const y = PADDING_TOP + ((7 - m.mood_value) / 6) * innerH;
      return { x, y, value: m.mood_value, id: m.id };
    });

    const segs: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      segs.push({
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        color: colorForValue((a.value + b.value) / 2),
      });
    }

    const ticks: { x: number; label: string }[] = [];
    const tickCount = 4;
    for (let i = 0; i <= tickCount; i++) {
      const t = startMs + (range * i) / tickCount;
      const d = new Date(t);
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      ticks.push({
        x: PADDING_X + (innerW * i) / tickCount,
        label,
      });
    }

    return { points: pts, segments: segs, xTicks: ticks };
  }, [moods, days]);

  if (points.length === 0) {
    return (
      <div
        className="rounded-xl p-6 text-center"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          No moods logged yet. Tap the smile in the header to add your first.
        </p>
      </div>
    );
  }

  const gridYValues = [1, 2, 3, 4, 5, 6, 7];
  const innerH = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  return (
    <div
      className="rounded-xl p-3"
      style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height="auto"
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        {gridYValues.map((v) => {
          const y = PADDING_TOP + ((7 - v) / 6) * innerH;
          return (
            <line
              key={v}
              x1={PADDING_X}
              x2={WIDTH - PADDING_X}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeWidth={0.5}
              opacity={v === 4 ? 0.8 : 0.3}
              strokeDasharray={v === 4 ? undefined : "2 3"}
            />
          );
        })}

        {segments.map((s, i) => (
          <line
            key={i}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}

        {points.map((p) => (
          <circle
            key={p.id}
            cx={p.x}
            cy={p.y}
            r={2.5}
            fill={colorForValue(p.value)}
            stroke="var(--background)"
            strokeWidth={1}
          />
        ))}

        {xTicks.map((t, i) => (
          <text
            key={i}
            x={t.x}
            y={HEIGHT - 4}
            fontSize={8}
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            fill="var(--muted-foreground)"
          >
            {t.label}
          </text>
        ))}
      </svg>

      <div className="flex justify-between mt-2 px-1">
        <div className="flex items-center gap-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: MOOD_COLORS[1] }}
          />
          <span className="text-[9px]" style={{ color: "var(--muted-foreground)" }}>
            Unpleasant
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px]" style={{ color: "var(--muted-foreground)" }}>
            Pleasant
          </span>
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: MOOD_COLORS[7] }}
          />
        </div>
      </div>
    </div>
  );
}
