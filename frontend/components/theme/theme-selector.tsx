"use client";

import { useTheme } from "@/components/theme/theme-provider";
import type { ThemeName } from "@/lib/types";

const themes: { name: ThemeName; label: string }[] = [
  { name: "minimal-dark", label: "Minimal Dark" },
  { name: "soft-neutral", label: "Soft Neutral" },
  { name: "glass-modern", label: "Glass Modern" },
];

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
        Theme
      </p>
      <div className="flex gap-2">
        {themes.map((t) => (
          <button
            key={t.name}
            onClick={() => setTheme(t.name)}
            className="flex-1 py-2.5 rounded-lg text-xs font-medium"
            style={{
              backgroundColor: theme === t.name ? "var(--foreground)" : "var(--card)",
              color: theme === t.name ? "var(--background)" : "var(--muted-foreground)",
              border: theme === t.name ? "none" : "1px solid var(--border)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
