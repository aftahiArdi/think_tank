"use client";

import { useRef, useState } from "react";

interface FabProps {
  onClick: () => void;
}

export function Fab({ onClick }: FabProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    setOffset({ x: dx * 0.3, y: dy * 0.3 });
  };

  const handleMouseLeave = () => setOffset({ x: 0, y: 0 });

  return (
    <button
      ref={btnRef}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="fixed bottom-20 right-4 z-40 w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-light shadow-lg active:scale-95"
      style={{
        background: "linear-gradient(135deg, var(--foreground), var(--muted-foreground))",
        color: "var(--background)",
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        transition: "transform 0.15s ease-out",
      }}
    >
      +
    </button>
  );
}
