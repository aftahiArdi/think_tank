"use client";

import { useRef, useState } from "react";
import { ReactSketchCanvas, type ReactSketchCanvasRef } from "react-sketch-canvas";
import { Button } from "@/components/ui/button";
import { Undo2, Trash2, X } from "lucide-react";

interface SketchPadProps {
  open: boolean;
  onClose: () => void;
  onSave: (blob: Blob) => void;
}

const COLORS = ["#ffffff", "#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7"];

export function SketchPad({ open, onClose, onSave }: SketchPadProps) {
  const canvasRef = useRef<ReactSketchCanvasRef>(null);
  const [strokeColor, setStrokeColor] = useState("#ffffff");
  const [strokeWidth, setStrokeWidth] = useState(3);

  if (!open) return null;

  const handleSave = async () => {
    if (!canvasRef.current) return;
    const dataUrl = await canvasRef.current.exportImage("png");
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    onSave(blob);
    canvasRef.current.clearCanvas();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ backgroundColor: "var(--background)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose}>
          <X size={24} style={{ color: "var(--foreground)" }} />
        </button>
        <span className="font-semibold" style={{ color: "var(--foreground)" }}>
          Sketch
        </span>
        <Button onClick={handleSave} size="sm">
          Done
        </Button>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <ReactSketchCanvas
          ref={canvasRef}
          strokeWidth={strokeWidth}
          strokeColor={strokeColor}
          canvasColor="transparent"
          style={{ border: "none" }}
          allowOnlyPointerType="all"
        />
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-3 pb-8"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="flex gap-2">
          {COLORS.map((color) => (
            <button
              key={color}
              onClick={() => setStrokeColor(color)}
              className="w-7 h-7 rounded-full"
              style={{
                backgroundColor: color,
                border: strokeColor === color ? "2px solid var(--primary)" : "2px solid transparent",
                outline: strokeColor === color ? "2px solid var(--background)" : "none",
              }}
            />
          ))}
        </div>
        <div className="flex gap-3">
          <input
            type="range"
            min={1}
            max={20}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-20"
          />
          <button onClick={() => canvasRef.current?.undo()}>
            <Undo2 size={20} style={{ color: "var(--muted-foreground)" }} />
          </button>
          <button onClick={() => canvasRef.current?.clearCanvas()}>
            <Trash2 size={20} style={{ color: "var(--muted-foreground)" }} />
          </button>
        </div>
      </div>
    </div>
  );
}
