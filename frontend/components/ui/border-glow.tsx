"use client";

import { useRef, useState, useCallback } from "react";

interface BorderGlowProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  edgeSensitivity?: number;
  borderRadius?: number;
  glowIntensity?: number;
  coneSpread?: number;
  colors?: string[];
}

export function BorderGlow({
  children,
  className = "",
  style,
  edgeSensitivity = 40,
  borderRadius = 12,
  glowIntensity = 1,
  coneSpread = 60,
  colors = ["#c084fc", "#f472b6", "#38bdf8"],
}: BorderGlowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [angle, setAngle] = useState(0);
  const [active, setActive] = useState(false);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { width: w, height: h } = rect;

    const dTop = y, dBottom = h - y, dLeft = x, dRight = w - x;
    const minDist = Math.min(dTop, dBottom, dLeft, dRight);

    if (minDist <= edgeSensitivity) {
      setActive(true);
      // Map perimeter position → 0–360°
      const perimeter = 2 * (w + h);
      const nearest = Math.min(dTop, dBottom, dLeft, dRight);
      let pos = 0;
      if (nearest === dTop)    pos = x;
      else if (nearest === dRight)  pos = w + y;
      else if (nearest === dBottom) pos = w + h + (w - x);
      else                          pos = 2 * w + h + (h - y);
      setAngle((pos / perimeter) * 360);
    } else {
      setActive(false);
    }
  }, [edgeSensitivity]);

  const colorStr = colors.join(", ");
  const half = coneSpread / 2;
  const conicGradient = `conic-gradient(from ${angle - half}deg, transparent, ${colorStr}, transparent)`;

  return (
    <div
      ref={ref}
      className={className}
      style={{ ...style, position: "relative", borderRadius, padding: 1 }}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setActive(false)}
    >
      {/* Base border — always visible */}
      <div
        style={{
          position: "absolute", inset: 0, borderRadius,
          background: "var(--border)",
          zIndex: 0,
        }}
      />
      {/* Glow border — fades in on edge hover */}
      <div
        style={{
          position: "absolute", inset: 0, borderRadius,
          background: conicGradient,
          opacity: active ? glowIntensity : 0,
          transition: "opacity 0.2s ease",
          zIndex: 1,
          pointerEvents: "none",
        }}
      />
      {/* Card content */}
      <div
        style={{
          position: "relative", zIndex: 2,
          borderRadius: borderRadius - 1,
          backgroundColor: "var(--card)",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
