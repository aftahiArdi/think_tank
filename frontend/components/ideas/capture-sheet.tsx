"use client";

import { useState, useRef, useEffect } from "react";
import { mutate as globalMutate } from "swr";
import { useUpload } from "@/lib/hooks/use-upload";
import { createIdea } from "@/lib/api";
import { Camera, Pencil, Video, X } from "lucide-react";
import { toast } from "sonner";

interface CaptureSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSketchOpen: () => void;
  sketchBlob: Blob | null;
  clearSketch: () => void;
}

export function CaptureSheet({
  open,
  onOpenChange,
  onSketchOpen,
  sketchBlob,
  clearSketch,
}: CaptureSheetProps) {
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useUpload();

  // Lock body scroll while sheet is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const handleSave = async () => {
    if (!content.trim() && files.length === 0 && !sketchBlob) return;
    setSaving(true);
    try {
      const result = await createIdea(content, undefined);
      const ideaId = result.id;

      const allFiles = [...files];
      if (sketchBlob) {
        allFiles.push(new File([sketchBlob], "sketch.png", { type: "image/png" }));
      }
      if (allFiles.length > 0) {
        try {
          await upload(ideaId, allFiles);
        } catch (e) {
          toast.error(`Upload failed: ${e instanceof Error ? e.message : "unknown error"}`);
        }
      }

      setContent("");
      setFiles([]);
      clearSketch();
      onOpenChange(false);
      globalMutate("ideas").catch(() => {});
    } catch (e) {
      toast.error(`Failed to save: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
  };

  const canSave = !saving && !uploading && (!!content.trim() || files.length > 0 || !!sketchBlob);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={() => onOpenChange(false)}
      />

      {/* Sheet */}
      <div
        className="fixed left-0 right-0 bottom-0 z-50 rounded-t-2xl flex flex-col"
        style={{
          backgroundColor: "var(--background)",
          maxHeight: "92dvh",
          borderTop: "1px solid var(--border)",
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ backgroundColor: "var(--border)" }} />
        </div>

        {/* Title */}
        <div className="flex items-center justify-between px-4 pb-3 flex-shrink-0">
          <span className="text-base font-semibold" style={{ color: "var(--foreground)" }}>New Idea</span>
          <button
            onClick={() => onOpenChange(false)}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--muted)" }}
          >
            <X size={14} style={{ color: "var(--muted-foreground)" }} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-4 pb-6 space-y-4"
          style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What's on your mind?"
            autoFocus
            rows={4}
            className="w-full resize-none rounded-xl p-3.5 text-sm outline-none leading-relaxed"
            style={{
              backgroundColor: "var(--card)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
            }}
          />

          {/* File previews */}
          {(files.length > 0 || sketchBlob) && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {files.map((f, i) => (
                <div key={i} className="relative flex-shrink-0 w-20 h-20">
                  {f.type.startsWith("image/") ? (
                    <img src={URL.createObjectURL(f)} alt="" className="w-20 h-20 rounded-xl object-cover" />
                  ) : (
                    <div className="w-20 h-20 rounded-xl flex items-center justify-center text-2xl"
                      style={{ backgroundColor: "var(--card)" }}>🎥</div>
                  )}
                  <button
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: "var(--muted-foreground)", color: "var(--background)" }}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              {sketchBlob && (
                <div className="relative flex-shrink-0 w-20 h-20">
                  <img src={URL.createObjectURL(sketchBlob)} alt="sketch"
                    className="w-20 h-20 rounded-xl object-cover" style={{ backgroundColor: "#111" }} />
                  <button
                    onClick={clearSketch}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: "var(--muted-foreground)", color: "var(--background)" }}
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Media buttons */}
          <div className="flex gap-2">
            {[
              { label: "Photo", icon: Camera, action: () => fileInputRef.current?.click() },
              { label: "Sketch", icon: Pencil, action: onSketchOpen },
              { label: "Video", icon: Video, action: () => videoInputRef.current?.click() },
            ].map(({ label, icon: Icon, action }) => (
              <button
                key={label}
                onClick={action}
                className="flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl"
                style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
              >
                <Icon size={18} style={{ color: "var(--muted-foreground)" }} />
                <span className="text-[10px] font-medium" style={{ color: "var(--muted-foreground)" }}>{label}</span>
              </button>
            ))}
          </div>

          <input ref={fileInputRef} type="file" accept="image/*,image/heic,image/heif" multiple onChange={handleFileSelect} className="hidden" />
          <input ref={videoInputRef} type="file" accept="video/*" onChange={handleFileSelect} className="hidden" />

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full py-3.5 rounded-xl text-sm font-semibold"
            style={{
              backgroundColor: canSave ? "var(--foreground)" : "var(--muted)",
              color: canSave ? "var(--background)" : "var(--muted-foreground)",
              transition: "background-color 0.15s ease",
            }}
          >
            {saving || uploading ? "Saving…" : "Save Idea"}
          </button>
        </div>
      </div>
    </>
  );
}
