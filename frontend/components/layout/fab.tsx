"use client";

interface FabProps {
  onClick: () => void;
}

export function Fab({ onClick }: FabProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-20 right-4 z-40 w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-light shadow-lg active:scale-95 transition-transform"
      style={{
        background: "linear-gradient(135deg, var(--foreground), var(--muted-foreground))",
        color: "var(--background)",
      }}
    >
      +
    </button>
  );
}
