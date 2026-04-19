"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { haptics } from "@/lib/haptics";
import { useMoods } from "@/lib/hooks/use-moods";
import { MoodSlider } from "./mood-slider";

interface MoodSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MoodSheet({ open, onOpenChange }: MoodSheetProps) {
  const [value, setValue] = useState(4);
  const [saving, setSaving] = useState(false);
  const { logMood } = useMoods();

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      setValue(4);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    haptics.success();
    try {
      await logMood(value);
      toast.success("Mood logged");
      onOpenChange(false);
    } catch (e) {
      toast.error(
        `Failed to log mood: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={() => onOpenChange(false)}
      />

      <div
        className="fixed left-0 right-0 bottom-0 z-50 rounded-t-2xl flex flex-col"
        style={{
          backgroundColor: "var(--background)",
          maxHeight: "80dvh",
          borderTop: "1px solid var(--border)",
        }}
      >
        <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
          <div
            className="w-9 h-1 rounded-full"
            style={{ backgroundColor: "var(--border)" }}
          />
        </div>

        <div className="flex items-center justify-between px-4 pb-3 flex-shrink-0">
          <span
            className="text-base font-semibold"
            style={{ color: "var(--foreground)" }}
          >
            How are you feeling?
          </span>
          <button
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--muted)" }}
          >
            <X size={14} style={{ color: "var(--muted-foreground)" }} />
          </button>
        </div>

        <div
          className="overflow-y-auto flex-1 px-4 pb-6 pt-6 space-y-8"
          style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}
        >
          <MoodSlider value={value} onChange={setValue} />

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3.5 rounded-xl text-sm font-semibold"
            style={{
              backgroundColor: saving ? "var(--muted)" : "var(--foreground)",
              color: saving ? "var(--muted-foreground)" : "var(--background)",
              transition: "background-color 0.15s ease",
            }}
          >
            {saving ? "Saving…" : "Log mood"}
          </button>
        </div>
      </div>
    </>
  );
}
