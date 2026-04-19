"use client";

import { Smile } from "lucide-react";

interface MoodButtonProps {
  onClick: () => void;
}

export function MoodButton({ onClick }: MoodButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label="Log mood"
      className="w-8 h-8 rounded-lg flex items-center justify-center"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <Smile size={16} style={{ color: "var(--muted-foreground)" }} />
    </button>
  );
}
