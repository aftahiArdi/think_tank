"use client";

import { Settings, BarChart3 } from "lucide-react";
import { CountUp } from "@/components/ui/count-up";
import { MoodButton } from "@/components/mood/mood-button";

export function Header({
  onSettingsClick,
  onStatsClick,
  onMoodClick,
  ideaCount = 0,
}: {
  onSettingsClick: () => void;
  onStatsClick?: () => void;
  onMoodClick?: () => void;
  ideaCount?: number;
}) {
  return (
    <header
      className="flex items-center justify-between px-4 sticky top-0 z-40"
      style={{
        backgroundColor: "var(--background)",
        paddingTop: "calc(env(safe-area-inset-top) + 12px)",
        paddingBottom: 12,
      }}
    >
      <div>
        <h1 className="text-xl font-bold tracking-tight"
            style={{
              background: "linear-gradient(135deg, var(--foreground), var(--muted-foreground))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>
          think tank
        </h1>
        {ideaCount > 0 && (
          <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
            <CountUp target={ideaCount} /> ideas
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onMoodClick && <MoodButton onClick={onMoodClick} />}
        {onStatsClick && (
          <button
            onClick={onStatsClick}
            aria-label="Stats"
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <BarChart3 size={16} style={{ color: "var(--muted-foreground)" }} />
          </button>
        )}
        <button
          onClick={onSettingsClick}
          aria-label="Settings"
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <Settings size={16} style={{ color: "var(--muted-foreground)" }} />
        </button>
      </div>
    </header>
  );
}
