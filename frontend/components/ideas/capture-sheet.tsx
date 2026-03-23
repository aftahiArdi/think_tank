"use client";

import { useState, useRef } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useCategories } from "@/lib/hooks/use-categories";
import { useIdeas } from "@/lib/hooks/use-ideas";
import { useUpload } from "@/lib/hooks/use-upload";
import { createIdea } from "@/lib/api";
import { Camera, Pencil, Video } from "lucide-react";
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
  const [selectedCategory, setSelectedCategory] = useState<number | undefined>();
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const { categories } = useCategories();
  const { mutate } = useIdeas();
  const { upload, uploading } = useUpload();

  const handleSave = async () => {
    if (!content.trim() && files.length === 0 && !sketchBlob) return;

    setSaving(true);
    try {
      const result = await createIdea(content, selectedCategory);
      const ideaId = result.id;

      // Upload files + sketch in parallel
      const allFiles = [...files];
      if (sketchBlob) {
        allFiles.push(new File([sketchBlob], "sketch.png", { type: "image/png" }));
      }

      if (allFiles.length > 0) {
        try {
          await upload(ideaId, allFiles);
        } catch {
          toast.error("Idea saved but media upload failed.");
        }
      }

      // Reset form
      setContent("");
      setSelectedCategory(undefined);
      setFiles([]);
      clearSketch();
      onOpenChange(false);
      mutate();
    } catch {
      toast.error("Failed to save idea.");
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>New Idea</DrawerTitle>
        </DrawerHeader>
        <div className="px-5 pb-8 space-y-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What's on your mind?"
            autoFocus
            rows={3}
            className="w-full resize-none rounded-lg p-3 text-sm outline-none"
            style={{
              backgroundColor: "var(--input)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
            }}
          />

          {/* Media buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-1 py-3 rounded-lg"
              style={{ backgroundColor: "var(--input)" }}
            >
              <Camera size={20} style={{ color: "var(--muted-foreground)" }} />
              <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>Photo</span>
            </button>
            <button
              onClick={onSketchOpen}
              className="flex-1 flex flex-col items-center gap-1 py-3 rounded-lg"
              style={{ backgroundColor: "var(--input)" }}
            >
              <Pencil size={20} style={{ color: "var(--muted-foreground)" }} />
              <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>Sketch</span>
            </button>
            <button
              onClick={() => videoInputRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-1 py-3 rounded-lg"
              style={{ backgroundColor: "var(--input)" }}
            >
              <Video size={20} style={{ color: "var(--muted-foreground)" }} />
              <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>Video</span>
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Preview attached files */}
          {(files.length > 0 || sketchBlob) && (
            <div className="flex gap-2 overflow-x-auto">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="w-16 h-16 rounded-lg flex-shrink-0 flex items-center justify-center text-xs relative"
                  style={{ backgroundColor: "var(--muted)" }}
                >
                  {f.type.startsWith("image/") ? "🖼" : "🎥"}
                  <button
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] flex items-center justify-center"
                    style={{ backgroundColor: "var(--muted-foreground)", color: "var(--background)" }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {sketchBlob && (
                <div
                  className="w-16 h-16 rounded-lg flex-shrink-0 flex items-center justify-center text-xs relative"
                  style={{ backgroundColor: "var(--muted)" }}
                >
                  ✏️
                  <button
                    onClick={clearSketch}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] flex items-center justify-center"
                    style={{ backgroundColor: "var(--muted-foreground)", color: "var(--background)" }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Category chips */}
          <div>
            <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>
              Category
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() =>
                    setSelectedCategory(selectedCategory === cat.id ? undefined : cat.id)
                  }
                  className="px-3 py-1.5 rounded-full text-[11px] font-medium"
                  style={{
                    backgroundColor:
                      selectedCategory === cat.id ? `${cat.color}30` : "var(--input)",
                    color: selectedCategory === cat.id ? cat.color : "var(--muted-foreground)",
                    border:
                      selectedCategory === cat.id
                        ? `1px solid ${cat.color}50`
                        : "1px solid var(--border)",
                  }}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={saving || uploading || (!content.trim() && files.length === 0 && !sketchBlob)}
            className="w-full rounded-xl py-6 text-base font-semibold"
          >
            {saving || uploading ? "Saving..." : "Save Idea"}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
