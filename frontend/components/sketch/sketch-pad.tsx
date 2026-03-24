"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Undo2, Trash2, X, Eraser } from "lucide-react";

interface SketchPadProps {
  open: boolean;
  onClose: () => void;
  onSave: (blob: Blob) => void;
}

const COLORS = [
  "#f5f5f5", "#ef4444", "#3b82f6", "#22c55e",
  "#eab308", "#a855f7", "#f97316", "#ec4899",
];
const BG = "#111111";

export function SketchPad({ open, onClose, onSave }: SketchPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState("#f5f5f5");
  const [width, setWidth] = useState(4);
  const [eraser, setEraser] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const activePointerId = useRef<number | null>(null);

  // Init canvas after flex layout settles
  useEffect(() => {
    if (!open) return;
    const init = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, rect.width, rect.height);
      setHistory([]);
    };
    // rAF ensures the flex layout has been painted before we measure
    const raf = requestAnimationFrame(init);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const getPos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const snapshot = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    setHistory((h) => [...h.slice(-29), ctx.getImageData(0, 0, c.width, c.height)]);
  }, []);

  const onStart = (e: React.PointerEvent) => {
    e.preventDefault();
    // If already drawing with another pointer (palm rejection), ignore
    if (activePointerId.current !== null) return;
    // Capture so pointermove keeps firing even if cursor leaves canvas
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    activePointerId.current = e.pointerId;
    snapshot();
    drawing.current = true;
    last.current = getPos(e);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    if (e.pointerId !== activePointerId.current) return;
    e.preventDefault();
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;

    // Use coalesced events for smoother lines (fills in skipped samples)
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events) {
      const rect = c.getBoundingClientRect();
      const p = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = eraser ? BG : color;
      // Apple Pencil provides pressure via e.pressure (0–1); use it for line width variation
      const pressure = ev.pressure > 0 ? ev.pressure : 1;
      ctx.lineWidth = (eraser ? width * 4 : width) * (e.pointerType === "pen" ? 0.5 + pressure : 1);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      last.current = p;
    }
  };

  const onEnd = (e: React.PointerEvent) => {
    if (e.pointerId !== activePointerId.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    drawing.current = false;
    last.current = null;
    activePointerId.current = null;
  };

  const undo = () => {
    if (!history.length) return;
    const c = canvasRef.current!;
    c.getContext("2d")!.putImageData(history[history.length - 1], 0, 0);
    setHistory((h) => h.slice(0, -1));
  };

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    snapshot();
    const rect = c.getBoundingClientRect();
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, rect.width, rect.height);
  };

  const save = () => {
    canvasRef.current?.toBlob((blob) => { if (blob) onSave(blob); }, "image/png");
  };

  if (!open) return null;

  const dotSize = Math.min(Math.max(eraser ? width * 4 : width, 4), 32);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col select-none overflow-hidden"
      style={{ backgroundColor: BG, height: "100dvh" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 flex-shrink-0"
        style={{
          height: 56,
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: "rgba(255,255,255,0.07)" }}
        >
          <X size={16} color="#999" />
        </button>
        <span className="text-sm font-semibold" style={{ color: "#ccc" }}>Sketch</span>
        <button
          onClick={save}
          className="px-4 py-2 rounded-xl text-sm font-semibold"
          style={{ backgroundColor: "#f5f5f5", color: "#111" }}
        >
          Done
        </button>
      </div>

      {/* Drawing canvas — takes all remaining space */}
      <canvas
        ref={canvasRef}
        className="flex-1 w-full touch-none block"
        style={{ cursor: eraser ? "cell" : "crosshair", minHeight: 0, touchAction: "none" }}
        onPointerDown={onStart}
        onPointerMove={onMove}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
      />

      {/* Toolbar — always visible at bottom */}
      <div
        className="flex-shrink-0 px-4 pt-3"
        style={{
          borderTop: "1px solid rgba(255,255,255,0.07)",
          paddingBottom: "max(24px, env(safe-area-inset-bottom))",
          backgroundColor: BG,
        }}
      >
        {/* Row 1: colors + tools */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2 flex-wrap">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { setColor(c); setEraser(false); }}
                className="w-7 h-7 rounded-full flex-shrink-0 transition-transform active:scale-90"
                style={{
                  backgroundColor: c,
                  border: !eraser && color === c ? "2.5px solid #fff" : "2.5px solid transparent",
                  outline: !eraser && color === c ? "2px solid rgba(255,255,255,0.25)" : "none",
                  outlineOffset: "1px",
                }}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            <button
              onClick={() => setEraser((v) => !v)}
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: eraser ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.07)" }}
            >
              <Eraser size={16} color={eraser ? "#fff" : "#777"} />
            </button>
            <button
              onClick={undo}
              disabled={!history.length}
              className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-25"
              style={{ backgroundColor: "rgba(255,255,255,0.07)" }}
            >
              <Undo2 size={16} color="#aaa" />
            </button>
            <button
              onClick={clear}
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: "rgba(255,255,255,0.07)" }}
            >
              <Trash2 size={16} color="#aaa" />
            </button>
          </div>
        </div>

        {/* Row 2: stroke width */}
        <div className="flex items-center gap-3 mt-3">
          <input
            type="range"
            min={1}
            max={24}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="flex-1 h-1 appearance-none rounded-full cursor-pointer"
            style={{ accentColor: eraser ? "#888" : color }}
          />
          <div
            className="rounded-full flex-shrink-0 transition-all"
            style={{
              width: dotSize,
              height: dotSize,
              backgroundColor: eraser ? "rgba(255,255,255,0.15)" : color,
            }}
          />
        </div>
      </div>
    </div>
  );
}
