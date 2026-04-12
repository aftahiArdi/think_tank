"use client";

import { X } from "lucide-react";

interface ShareConfirmSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  content: string;
}

export function ShareConfirmSheet({ open, onClose, onConfirm, content }: ShareConfirmSheetProps) {
  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={onClose}
      />
      <div
        className="fixed left-0 right-0 bottom-0 z-50 rounded-t-2xl"
        style={{
          backgroundColor: "var(--background)",
          borderTop: "1px solid var(--border)",
          paddingBottom: "max(24px, env(safe-area-inset-bottom))",
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-9 h-1 rounded-full" style={{ backgroundColor: "var(--border)" }} />
        </div>

        <div className="px-5 pb-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              Share to feed?
            </h3>
            <button onClick={onClose}>
              <X size={18} style={{ color: "var(--muted-foreground)" }} />
            </button>
          </div>

          {/* Prompt */}
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Is this thought worth sharing with everyone?
          </p>

          {/* Preview */}
          {content && (
            <div
              className="rounded-xl px-4 py-3 text-sm leading-relaxed"
              style={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"],
                overflow: "hidden",
              }}
            >
              {content}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-medium"
              style={{
                backgroundColor: "var(--muted)",
                color: "var(--muted-foreground)",
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => { onConfirm(); onClose(); }}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{
                backgroundColor: "var(--foreground)",
                color: "var(--background)",
              }}
            >
              Share
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
