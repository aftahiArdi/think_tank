"use client";

import { useRef, useState, useCallback } from "react";

interface GlowCardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export function GlowCard({ children, className = "", style, onClick }: GlowCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [hovered, setHovered] = useState(false);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...style,
        position: "relative",
        borderRadius: 12,
        border: "1px solid var(--border)",
        backgroundColor: "var(--card)",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered
          ? "0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)"
          : "none",
        transition: "transform 0.2s ease, box-shadow 0.2s ease",
        overflow: "hidden",
        cursor: onClick ? "pointer" : undefined,
      }}
    >
      {hovered && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: `radial-gradient(circle at ${pos.x}% ${pos.y}%, rgba(255,255,255,0.04) 0%, transparent 65%)`,
          }}
        />
      )}
      <div style={{ position: "relative" }}>
        {children}
      </div>
    </div>
  );
}
