"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { MOOD_COLORS, MOOD_GRADIENT, MOOD_LABELS, type MoodValue } from "@/lib/mood";
import { haptics } from "@/lib/haptics";

interface MoodSliderProps {
  value: number;
  onChange: (value: number) => void;
}

function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function colorAt(fractional: number): string {
  const clamped = Math.max(1, Math.min(7, fractional));
  const lower = Math.floor(clamped);
  const upper = Math.min(7, lower + 1);
  const t = clamped - lower;
  return lerpHex(
    MOOD_COLORS[lower as MoodValue],
    MOOD_COLORS[upper as MoodValue],
    t,
  );
}

export function MoodSlider({ value, onChange }: MoodSliderProps) {
  // Fractional display position for smooth drag; snaps to integer on release.
  const [displayValue, setDisplayValue] = useState(value);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const lastStepRef = useRef(value);

  useEffect(() => {
    if (!dragging) {
      setDisplayValue(value);
      lastStepRef.current = value;
    }
  }, [value, dragging]);

  const updateFromClientX = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const fractional = 1 + pct * 6;
      setDisplayValue(fractional);
      const snapped = Math.round(fractional);
      if (snapped !== lastStepRef.current) {
        lastStepRef.current = snapped;
        haptics.tap();
        onChange(snapped);
      }
    },
    [onChange],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    updateFromClientX(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    updateFromClientX(e.clientX);
  };

  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    setDisplayValue(Math.round(displayValue));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(1, Math.round(displayValue) - 1);
      if (next !== Math.round(displayValue)) {
        setDisplayValue(next);
        lastStepRef.current = next;
        onChange(next);
        haptics.tap();
      }
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(7, Math.round(displayValue) + 1);
      if (next !== Math.round(displayValue)) {
        setDisplayValue(next);
        lastStepRef.current = next;
        onChange(next);
        haptics.tap();
      }
    }
  };

  const pct = ((displayValue - 1) / 6) * 100;
  const color = colorAt(displayValue);
  const snapped = Math.round(Math.max(1, Math.min(7, displayValue))) as MoodValue;
  const label = MOOD_LABELS[snapped];

  return (
    <div className="flex flex-col gap-7 select-none">
      <div className="text-center h-10 flex items-center justify-center">
        <p
          key={label}
          className="mood-label text-2xl font-semibold tracking-tight"
          style={{ color, transition: "color 120ms ease-out" }}
        >
          {label}
        </p>
      </div>

      <div className="px-1">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-valuemin={1}
          aria-valuemax={7}
          aria-valuenow={snapped}
          aria-valuetext={label}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className="relative h-11 flex items-center outline-none cursor-pointer"
          style={{ touchAction: "none" }}
        >
          <div
            className="w-full h-3 rounded-full"
            style={{
              background: MOOD_GRADIENT,
              boxShadow: "inset 0 1px 3px rgba(0, 0, 0, 0.2)",
            }}
          />

          <div
            className="absolute top-1/2 pointer-events-none"
            style={{
              left: `${pct}%`,
              transform: `translate(-50%, -50%) scale(${dragging ? 1.15 : 1})`,
              transition: dragging
                ? "transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1)"
                : "left 320ms cubic-bezier(0.22, 1, 0.36, 1), transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
              willChange: "left, transform",
            }}
          >
            <div
              className="w-8 h-8 rounded-full"
              style={{
                backgroundColor: "#ffffff",
                border: `4px solid ${color}`,
                boxShadow: dragging
                  ? `0 0 0 8px ${color}2A, 0 6px 18px rgba(0, 0, 0, 0.35)`
                  : "0 2px 10px rgba(0, 0, 0, 0.25)",
                transition:
                  "box-shadow 200ms ease-out, border-color 120ms ease-out",
              }}
            />
          </div>
        </div>

        <div className="flex justify-between mt-3 px-0.5">
          <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
            Very Unpleasant
          </span>
          <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
            Very Pleasant
          </span>
        </div>
      </div>

      <style jsx>{`
        .mood-label {
          animation: moodLabelFade 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes moodLabelFade {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
