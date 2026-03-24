"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Lightbulb, Search, FolderOpen, Plus } from "lucide-react";

export type TabName = "ideas" | "search" | "categories";

const tabs: { name: TabName; icon: typeof Lightbulb; label: string }[] = [
  { name: "ideas",      icon: Lightbulb,  label: "Ideas"    },
  { name: "search",     icon: Search,     label: "Search"   },
  { name: "categories", icon: FolderOpen, label: "Settings" },
];

interface BottomNavProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  onAdd: () => void;
}

export function BottomNav({ activeTab, onTabChange, onAdd }: BottomNavProps) {
  const activeIndex = tabs.findIndex((t) => t.name === activeTab);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number; animate: boolean }>({
    x: 0, w: 0, animate: false,
  });

  useLayoutEffect(() => {
    const btn = btnRefs.current[activeIndex];
    const container = containerRef.current;
    if (!btn || !container) return;
    const b = btn.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    setPill((prev) => ({
      x: b.left - c.left,
      w: b.width,
      animate: prev.w > 0,
    }));
  }, [activeIndex]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-center items-end pointer-events-none"
      style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
      <div className="relative flex items-center gap-2 pointer-events-auto">
        {/* Nav tabs */}
        <div
          ref={containerRef}
          className="relative flex items-center p-1 rounded-2xl"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.15), 0 1px 0 rgba(255,255,255,0.05) inset",
          }}
        >
          {pill.w > 0 && (
            <div
              className="absolute top-1 bottom-1 rounded-xl"
              style={{
                width: pill.w,
                left: pill.x,
                backgroundColor: "var(--foreground)",
                transition: pill.animate
                  ? "left 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)"
                  : "none",
              }}
            />
          )}

          {tabs.map((tab, i) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.name;
            return (
              <button
                key={tab.name}
                ref={(el) => { btnRefs.current[i] = el; }}
                onClick={() => onTabChange(tab.name)}
                className="relative z-10 flex flex-col items-center gap-0.5 px-6 py-2 rounded-xl"
                style={{
                  transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
              >
                <Icon
                  size={18}
                  style={{
                    color: isActive ? "var(--background)" : "var(--muted-foreground)",
                    transition: "color 0.2s ease",
                  }}
                />
                <span
                  className="text-[10px] font-semibold tracking-wide"
                  style={{
                    color: isActive ? "var(--background)" : "var(--muted-foreground)",
                    transition: "color 0.2s ease",
                  }}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Add button */}
        <button
          onClick={onAdd}
          className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg active:scale-90"
          style={{
            background: "linear-gradient(135deg, var(--foreground), var(--muted-foreground))",
            color: "var(--background)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.2), 0 1px 0 rgba(255,255,255,0.05) inset",
            transition: "transform 0.15s ease-out",
          }}
        >
          <Plus size={26} strokeWidth={2.5} />
        </button>
      </div>
    </nav>
  );
}
