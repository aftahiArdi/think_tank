"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { mutate as globalMutate } from "swr";
import { useUpload } from "@/lib/hooks/use-upload";
import { createIdea } from "@/lib/api";
import { Camera, Pencil, Video, X, Mic, Square, Play, Pause } from "lucide-react";
import { toast } from "sonner";

interface CaptureSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSketchOpen: () => void;
  sketchBlob: Blob | null;
  clearSketch: () => void;
  onAdd?: (content: string) => void;
}

interface AudioPreview {
  file: File;
  url: string;
  duration: number; // seconds
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CaptureSheet({
  open,
  onOpenChange,
  onSketchOpen,
  sketchBlob,
  clearSketch,
  onAdd,
}: CaptureSheetProps) {
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioPreview, setAudioPreview] = useState<AudioPreview | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioElemRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      stopRecording(false);
    }
  }, [open]);

  const stopRecording = useCallback((save = true) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      if (save) {
        mediaRecorderRef.current.stop();
      } else {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setRecording(false);
    setRecordingSeconds(0);
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Pick best supported format
      const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]
        .find((t) => MediaRecorder.isTypeSupported(t)) || "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/mp4" });
        const ext = recorder.mimeType?.includes("webm") ? "webm" : "m4a";
        const file = new File([blob], `voice-memo.${ext}`, { type: blob.type });
        const url = URL.createObjectURL(blob);

        // Get duration
        const audio = new Audio(url);
        audio.addEventListener("loadedmetadata", () => {
          setAudioPreview({ file, url, duration: audio.duration });
        });

        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecording(false);
        setRecordingSeconds(0);
      };

      recorder.start(100);
      setRecording(true);

      timerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch {
      toast.error("Microphone access denied");
    }
  };

  const handleMicPress = () => {
    if (recording) {
      stopRecording(true);
    } else {
      startRecording();
    }
  };

  const removeAudio = () => {
    if (audioPreview) {
      URL.revokeObjectURL(audioPreview.url);
      setAudioPreview(null);
    }
    setAudioPlaying(false);
  };

  const togglePlayback = () => {
    if (!audioPreview) return;
    if (!audioElemRef.current) {
      audioElemRef.current = new Audio(audioPreview.url);
      audioElemRef.current.onended = () => setAudioPlaying(false);
    }
    if (audioPlaying) {
      audioElemRef.current.pause();
      setAudioPlaying(false);
    } else {
      audioElemRef.current.play();
      setAudioPlaying(true);
    }
  };

  const handleSave = async () => {
    const allMediaFiles = audioPreview ? [...files, audioPreview.file] : [...files];
    if (!content.trim() && allMediaFiles.length === 0 && !sketchBlob) return;

    const capturedContent = content;
    const capturedFiles = allMediaFiles;
    const capturedSketch = sketchBlob;

    // Text-only: close instantly via optimistic update
    if (capturedFiles.length === 0 && !capturedSketch) {
      setContent("");
      onOpenChange(false);
      onAdd?.(capturedContent);
      return;
    }

    setSaving(true);
    try {
      const result = await createIdea(capturedContent, undefined);
      const ideaId = result.id;

      setContent("");
      setFiles([]);
      setAudioPreview(null);
      clearSketch();
      onOpenChange(false);
      setSaving(false);
      globalMutate("ideas").catch(() => {});

      const uploadFiles = [...capturedFiles];
      if (capturedSketch) {
        uploadFiles.push(new File([capturedSketch], "sketch.png", { type: "image/png" }));
      }
      upload(ideaId, uploadFiles)
        .then(() => globalMutate("ideas").catch(() => {}))
        .catch((e) => toast.error(`Upload failed: ${e instanceof Error ? e.message : "unknown error"}`));
    } catch (e) {
      toast.error(`Failed to save: ${e instanceof Error ? e.message : "unknown error"}`);
      setSaving(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
  };

  const canSave = !saving && !uploading && !recording &&
    (!!content.trim() || files.length > 0 || !!sketchBlob || !!audioPreview);

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

          {/* Audio preview */}
          {audioPreview && (
            <div
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <button
                onClick={togglePlayback}
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "var(--primary)" }}
              >
                {audioPlaying
                  ? <Pause size={14} style={{ color: "var(--primary-foreground)" }} />
                  : <Play size={14} style={{ color: "var(--primary-foreground)" }} />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium" style={{ color: "var(--foreground)" }}>Voice Memo</div>
                <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  {formatDuration(audioPreview.duration)}
                </div>
              </div>
              <button onClick={removeAudio}>
                <X size={14} style={{ color: "var(--muted-foreground)" }} />
              </button>
            </div>
          )}

          {/* Recording indicator */}
          {recording && (
            <div
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{
                backgroundColor: "#ef4444",
                animation: "pulse 1s ease-in-out infinite",
              }} />
              <span className="flex-1 text-sm font-medium tabular-nums" style={{ color: "var(--foreground)" }}>
                {formatDuration(recordingSeconds)}
              </span>
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>Recording…</span>
            </div>
          )}

          {/* Media buttons */}
          <div className="flex gap-2">
            {[
              { label: "Photo", icon: Camera, action: () => fileInputRef.current?.click() },
              { label: "Sketch", icon: Pencil, action: onSketchOpen },
              { label: "Video", icon: Video, action: () => videoInputRef.current?.click() },
              {
                label: recording ? "Stop" : "Voice",
                icon: recording ? Square : Mic,
                action: handleMicPress,
                active: recording,
              },
            ].map(({ label, icon: Icon, action, active }) => (
              <button
                key={label}
                onClick={action}
                className="flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl"
                style={{
                  backgroundColor: active ? "rgba(239,68,68,0.15)" : "var(--card)",
                  border: `1px solid ${active ? "#ef4444" : "var(--border)"}`,
                }}
              >
                <Icon
                  size={18}
                  style={{ color: active ? "#ef4444" : "var(--muted-foreground)" }}
                />
                <span className="text-[10px] font-medium" style={{ color: active ? "#ef4444" : "var(--muted-foreground)" }}>
                  {label}
                </span>
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
