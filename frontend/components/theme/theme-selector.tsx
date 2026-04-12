"use client";

import { useTheme } from "@/components/theme/theme-provider";
import type { ThemeName } from "@/lib/types";

const THEMES: { name: ThemeName; label: string; bg: string; card: string; accent: string }[] = [
  { name: "minimal-dark",  label: "Minimal Dark",  bg: "#0a0a0a", card: "#141414",              accent: "#fafafa"  },
  { name: "soft-neutral",  label: "Soft Neutral",  bg: "#f8f7f4", card: "#ffffff",              accent: "#1a1a1a"  },
  { name: "glass-modern",  label: "Glass Modern",  bg: "#0f0f1a", card: "rgba(255,255,255,.06)", accent: "#a78bfa"  },
  { name: "midnight",      label: "Midnight",      bg: "#0d1117", card: "#161b22",              accent: "#e6edf3"  },
  { name: "moonlight",     label: "Moonlight",     bg: "#1e1e2e", card: "#27273a",              accent: "#cba6f7"  },
  { name: "warm-charcoal", label: "Warm",          bg: "#111110", card: "#1c1b1a",              accent: "#eeede9"  },
  { name: "nord",          label: "Nord",          bg: "#1a1e2e", card: "#242938",              accent: "#89b4fa"  },
  { name: "forest",        label: "Forest",        bg: "#0d1210", card: "#141d19",              accent: "#4ade80"  },
];

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>
        Theme
      </p>
      <div className="grid grid-cols-4 gap-2">
        {THEMES.map((t) => {
          const active = theme === t.name;
          return (
            <button
              key={t.name}
              onClick={() => setTheme(t.name)}
              className="flex flex-col items-center gap-1.5 p-2 rounded-xl active:scale-95 transition-transform"
              style={{
                backgroundColor: t.bg,
                border: active ? "2px solid var(--foreground)" : "1px solid var(--border)",
              }}
            >
              {/* colour chips */}
              <div className="flex gap-0.5">
                <div className="w-3 h-3 rounded-sm" style={{ background: t.bg, border: "1px solid rgba(255,255,255,0.15)" }} />
                <div className="w-3 h-3 rounded-sm" style={{ background: t.card }} />
                <div className="w-3 h-3 rounded-sm" style={{ background: t.accent }} />
              </div>
              <span
                className="text-[9px] font-medium leading-none"
                style={{ color: t.accent }}
              >
                {active ? "✓ " : ""}{t.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
