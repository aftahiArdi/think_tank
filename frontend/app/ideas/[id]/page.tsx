"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { ArrowLeft, Trash2, Calendar, Clock, Copy, Check, Star, Share2, MapPin } from "lucide-react";
import { fetchIdea, deleteIdea, starIdea, shareIdea, unshareIdea } from "@/lib/api";
import { ShareConfirmSheet } from "@/components/feed/share-confirm-sheet";
import { getCurrentUsername } from "@/lib/biometric";
import { mutate as globalMutate } from "swr";
import { formatDate, formatTime } from "@/lib/utils/dates";
import type { Idea } from "@/lib/types";
import { VoiceMemoPlayer } from "@/components/ui/voice-memo-player";
import { YouTubePreview, extractYouTubeVideoId } from "@/components/ui/youtube-preview";
import { LinkPreview } from "@/components/ui/link-preview";
import { toast } from "sonner";

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

const URL_REGEX = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;

function linkify(text: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <a key={match.index} href={match[0]} target="_blank" rel="noopener noreferrer"
        className="underline break-all" style={{ color: "var(--primary)" }}>
        {match[0]}
      </a>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const ideaId = Number(id);
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [starring, setStarring] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [isSharedOverride, setIsSharedOverride] = useState<boolean | null>(null);
  const currentUsername = getCurrentUsername();

  // Read the feed cache NON-reactively as a hint — no subscription, no refetch of the full list.
  const { cache } = useSWRConfig();
  const feedHint = (cache.get("ideas")?.data as { ideas: Idea[] } | undefined)
    ?.ideas.find(i => i.id === ideaId);

  // Single-idea SWR — the card's onPointerDown seeds this cache, so in the happy path
  // `data` is already populated on first render and there's no network wait.
  const { data: fetched, isLoading } = useSWR(
    `idea-${ideaId}`,
    () => fetchIdea(ideaId),
    { fallbackData: feedHint }
  );

  const idea: Idea | undefined = fetched;

  // Derive isShared: use optimistic override when set, else fall back to idea data (no extra render needed)
  const isShared = isSharedOverride ?? idea?.is_shared ?? null;

  const handleStar = async () => {
    if (!idea || starring) return;
    setStarring(true);
    try {
      await starIdea(idea.id, !idea.starred);
      globalMutate("ideas").catch(() => {});
      globalMutate(`idea-${ideaId}`).catch(() => {});
    } catch {
      toast.error("Failed to update star.");
    } finally {
      setStarring(false);
    }
  };

  const handleDelete = async () => {
    if (!idea) return;
    setDeleting(true);
    try {
      await deleteIdea(idea.id);
      globalMutate("ideas").catch(() => {});
      router.back();
    } catch {
      toast.error("Failed to delete idea.");
      setDeleting(false);
    }
  };

  const handleShare = async () => {
    if (!idea) return;
    setIsSharedOverride(true);
    try {
      await shareIdea(idea.id);
      globalMutate("feed").catch(() => {});
    } catch {
      setIsSharedOverride(null);
      toast.error("Failed to share.");
    }
  };

  const handleUnshare = async () => {
    if (!idea) return;
    setIsSharedOverride(false);
    try {
      await unshareIdea(idea.id);
      globalMutate("feed").catch(() => {});
    } catch {
      setIsSharedOverride(null);
      toast.error("Failed to unshare.");
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)", paddingBottom: "calc(env(safe-area-inset-bottom) + 48px)" }}>
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-4"
        style={{
          backgroundColor: "var(--background)",
          borderBottom: "1px solid var(--border)",
          paddingTop: "calc(env(safe-area-inset-top) + 12px)",
          paddingBottom: 12,
        }}
      >
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm font-medium"
          style={{ color: "var(--muted-foreground)" }}
        >
          <ArrowLeft size={16} />
          Back
        </button>

        {idea && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleStar}
              disabled={starring}
              className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-40"
              style={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                color: idea.starred ? "#facc15" : "var(--muted-foreground)",
              }}
            >
              <Star
                size={15}
                fill={idea.starred ? "#facc15" : "none"}
                strokeWidth={idea.starred ? 0 : 1.5}
              />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-40"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <Trash2 size={15} style={{ color: "var(--destructive)" }} />
            </button>
          </div>
        )}
      </header>

      {/* Loading */}
      {!idea && isLoading && (
        <div className="flex items-center justify-center pt-24"
          style={{ color: "var(--muted-foreground)" }}>
          Loading…
        </div>
      )}

      {idea && (
        <div className="max-w-lg mx-auto px-4 pt-5 space-y-4">

          {/* Timestamp card */}
          <div
            className="flex items-center gap-4 px-4 py-3 rounded-2xl"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-1.5" style={{ color: "var(--muted-foreground)" }}>
              <Calendar size={13} />
              <span className="text-xs font-medium">{formatDate(idea.timestamp)}</span>
            </div>
            <div
              className="w-px self-stretch"
              style={{ backgroundColor: "var(--border)" }}
            />
            <div className="flex items-center gap-1.5" style={{ color: "var(--muted-foreground)" }}>
              <Clock size={13} />
              <span className="text-xs">{formatTime(idea.timestamp)}</span>
            </div>
          </div>

          {/* Location card — opens Apple Maps */}
          {idea.latitude !== null && idea.longitude !== null && (
            <a
              href={`https://maps.apple.com/?ll=${idea.latitude},${idea.longitude}&q=${encodeURIComponent(idea.location_name ?? "Idea")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-2xl active:opacity-70 transition-opacity"
              style={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                textDecoration: "none",
                opacity: idea.location_name ? 1 : 0.7,
              }}
            >
              <MapPin size={15} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
              <span
                className="text-xs font-medium truncate"
                style={{ color: "var(--foreground)" }}
              >
                {idea.location_name ?? "Locating…"}
              </span>
            </a>
          )}

          {/* Content card */}
          {idea.content && (
            <div
              className="px-5 py-4 rounded-2xl"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <p className="text-base leading-relaxed select-text whitespace-pre-wrap"
                style={{ color: "var(--foreground)" }}>
                {linkify(idea.content)}
              </p>
              <button
                onClick={() => {
                  copyText(idea.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex items-center gap-1.5 mt-3 pt-3"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                {copied
                  ? <Check size={13} style={{ color: "var(--foreground)" }} />
                  : <Copy size={13} style={{ color: "var(--muted-foreground)" }} />
                }
                <span className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                  {copied ? "Copied" : "Copy text"}
                </span>
              </button>
            </div>
          )}

          {/* Link preview */}
          {idea.content && (
            extractYouTubeVideoId(idea.content)
              ? <YouTubePreview content={idea.content} />
              : <LinkPreview content={idea.content} />
          )}

          {/* Media */}
          {idea.media.length > 0 && (
            <div className="space-y-3">
              {idea.media.map((m) =>
                m.media_type === "video" ? (
                  <video
                    key={m.id}
                    src={m.url}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full rounded-2xl"
                    style={{ backgroundColor: "var(--card)" }}
                  />
                ) : m.media_type === "audio" ? (
                  <VoiceMemoPlayer key={m.id} src={m.url} />
                ) : (
                  <button
                    key={m.id}
                    onClick={() => setLightbox(m.url)}
                    className="block w-full overflow-hidden rounded-2xl"
                    style={{ border: "1px solid var(--border)" }}
                  >
                    <img
                      src={m.url}
                      alt=""
                      className="w-full object-contain"
                      style={{
                        backgroundColor: m.media_type === "sketch" ? "#111" : "var(--card)",
                        maxHeight: "70vh",
                      }}
                    />
                  </button>
                )
              )}
            </div>
          )}

          {!idea.content && idea.media.length === 0 && (
            <div
              className="px-5 py-4 rounded-2xl"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <p className="text-sm italic" style={{ color: "var(--muted-foreground)" }}>
                Empty idea.
              </p>
            </div>
          )}

          {/* Share to feed — only shown for own ideas */}
          {idea.owner_username === currentUsername && isShared !== null && (
            <div>
              {isShared ? (
                <button
                  onClick={handleUnshare}
                  className="w-full py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    color: "var(--muted-foreground)",
                  }}
                >
                  <Share2 size={15} />
                  Shared to feed · Remove
                </button>
              ) : (
                <button
                  onClick={() => setShareSheetOpen(true)}
                  className="w-full py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    color: "var(--foreground)",
                  }}
                >
                  <Share2 size={15} />
                  Share to feed
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-2xl overflow-hidden"
            style={{
              backgroundColor: "var(--card)",
              marginBottom: "max(24px, env(safe-area-inset-bottom))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 text-center" style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-sm font-semibold mb-1" style={{ color: "var(--foreground)" }}>
                Delete this idea?
              </p>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                This can&apos;t be undone.
              </p>
            </div>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="w-full py-3.5 text-sm font-semibold disabled:opacity-40"
              style={{ color: "var(--destructive)", borderBottom: "1px solid var(--border)" }}
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="w-full py-3.5 text-sm font-medium"
              style={{ color: "var(--muted-foreground)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-w-full max-h-full object-contain p-4" />
        </div>
      )}

      <ShareConfirmSheet
        open={shareSheetOpen}
        onClose={() => setShareSheetOpen(false)}
        onConfirm={handleShare}
        content={idea?.content ?? ""}
      />
    </div>
  );
}
