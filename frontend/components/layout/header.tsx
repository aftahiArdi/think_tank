"use client";

import { Settings } from "lucide-react";

export function Header({ onSettingsClick }: { onSettingsClick: () => void }) {
  return (
    <header className="flex items-center justify-between px-4 py-3 sticky top-0 z-40"
            style={{ backgroundColor: "var(--background)" }}>
      <h1 className="text-xl font-bold tracking-tight"
          style={{
            background: "linear-gradient(135deg, var(--foreground), var(--muted-foreground))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
        think tank
      </h1>
      <button
        onClick={onSettingsClick}
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        <Settings size={16} style={{ color: "var(--muted-foreground)" }} />
      </button>
    </header>
  );
}
