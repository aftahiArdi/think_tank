"use client";

import { use, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  acquireSummaryLock,
  isSummaryInflight,
  releaseSummaryLock,
  subscribeSummaryLock,
} from "@/lib/summary-lock";
import { ArrowLeft, Sparkles, RefreshCw } from "lucide-react";
import {
  fetchDailySummary,
  fetchIdeasByDate,
  generateDailySummary,
} from "@/lib/api";
import type { Idea, IdeaMedia } from "@/lib/types";
import { formatDate } from "@/lib/utils/dates";
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceMemoPlayer } from "@/components/ui/voice-memo-player";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";

interface DayStats {
  total: number;
  text: number;
  image: number;
  sketch: number;
  video: number;
  audio: number;
  starred: number;
}

function computeDayStats(ideas: Idea[]): DayStats {
  const s: DayStats = { total: ideas.length, text: 0, image: 0, sketch: 0, video: 0, audio: 0, starred: 0 };
  for (const i of ideas) {
    if (i.starred) s.starred++;
    if (i.media_type === "mixed") {
      for (const m of i.media) {
        if (m.media_type === "image") s.image++;
        else if (m.media_type === "sketch") s.sketch++;
        else if (m.media_type === "video") s.video++;
        else if (m.media_type === "audio") s.audio++;
      }
    } else if (i.media_type === "text") {
      s.text++;
    } else {
      s[i.media_type]++;
    }
  }
  return s;
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-3 rounded-xl"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <span className="text-xl font-bold tabular-nums" style={{ color: "var(--foreground)" }}>
        {value}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
        {label}
      </span>
    </div>
  );
}

function MediaGrid({ items }: { items: IdeaMedia[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {items.map((m) => (
        <div
          key={m.id}
          className="relative aspect-square rounded-lg overflow-hidden"
          style={{ backgroundColor: "var(--muted)" }}
        >
          {m.media_type === "video" ? (
            <>
              <video src={m.url} preload="metadata" muted playsInline className="w-full h-full object-cover" />
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{ backgroundColor: "rgba(0,0,0,0.25)" }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: "rgba(255,255,255,0.9)" }}
                >
                  <div
                    style={{
                      width: 0,
                      height: 0,
                      borderLeft: "10px solid #000",
                      borderTop: "6px solid transparent",
                      borderBottom: "6px solid transparent",
                      marginLeft: 2,
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <img src={m.url} alt="" loading="lazy" className="w-full h-full object-cover" />
          )}
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[11px] font-bold uppercase tracking-widest mb-2"
      style={{ color: "var(--muted-foreground)" }}
    >
      {children}
    </h2>
  );
}

export default function RecapDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  const router = useRouter();

  const {
    data: summaryData,
    isLoading: summaryLoading,
    mutate: mutateSummary,
  } = useSWR(["daily-summary", date], () => fetchDailySummary(date));
  const { data: ideasData, isLoading: ideasLoading } = useSWR(
    ["ideas-by-date", date],
    () => fetchIdeasByDate(date),
  );

  const regenerating = useSyncExternalStore(
    subscribeSummaryLock,
    () => isSummaryInflight(date),
    () => false,
  );
  const ideas = ideasData?.ideas ?? [];
  const stats = computeDayStats(ideas);

  const allMedia: IdeaMedia[] = ideas.flatMap((i) => i.media);
  const images = allMedia.filter((m) => m.media_type === "image");
  const sketches = allMedia.filter((m) => m.media_type === "sketch");
  const videos = allMedia.filter((m) => m.media_type === "video");
  const audios = allMedia.filter((m) => m.media_type === "audio");

  const regenerate = async () => {
    if (!acquireSummaryLock(date)) return;
    haptics.tap();
    try {
      const result = await generateDailySummary(true, date);
      await mutateSummary(result, { revalidate: false });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Summary failed");
    } finally {
      releaseSummaryLock(date);
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: "var(--background)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 40px)",
      }}
    >
      <header
        className="flex items-center justify-between px-4 sticky top-0 z-40"
        style={{
          backgroundColor: "var(--background)",
          paddingTop: "calc(env(safe-area-inset-top) + 12px)",
          paddingBottom: 12,
        }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <ArrowLeft size={16} style={{ color: "var(--muted-foreground)" }} />
        </button>
        <h1 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          {formatDate(`${date} 00:00:00`)}
        </h1>
        <button
          onClick={regenerate}
          disabled={regenerating || summaryLoading}
          aria-label="Regenerate summary"
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <RefreshCw
            size={14}
            style={{
              color: "var(--muted-foreground)",
              animation: regenerating ? "spin 0.8s linear infinite" : "none",
            }}
          />
        </button>
      </header>

      <main className="px-4 pt-2 max-w-lg mx-auto space-y-5">
        <div
          className="rounded-xl p-4"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest mb-2"
            style={{ color: "var(--muted-foreground)" }}
          >
            <Sparkles size={11} />
            Summary
          </div>
          {summaryLoading || regenerating ? (
            <Skeleton className="h-20 w-full rounded-lg" />
          ) : summaryData?.summary ? (
            <p
              className="text-sm leading-relaxed whitespace-pre-wrap"
              style={{ color: "var(--foreground)" }}
            >
              {summaryData.summary}
            </p>
          ) : (
            <button
              onClick={regenerate}
              disabled={regenerating || ideas.length === 0}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-xs font-semibold"
              style={{
                backgroundColor: "var(--foreground)",
                color: "var(--background)",
                opacity: ideas.length === 0 ? 0.4 : 1,
              }}
            >
              <Sparkles size={13} />
              {ideas.length === 0 ? "No ideas to summarize" : "Generate recap"}
            </button>
          )}
        </div>

        <div>
          <SectionHeading>Stats</SectionHeading>
          <div className="grid grid-cols-4 gap-2">
            <StatTile label="Total" value={stats.total} />
            <StatTile label="Text" value={stats.text} />
            <StatTile label="Photos" value={stats.image} />
            <StatTile label="Sketches" value={stats.sketch} />
            <StatTile label="Videos" value={stats.video} />
            <StatTile label="Voice" value={stats.audio} />
            <StatTile label="Starred" value={stats.starred} />
          </div>
        </div>

        {ideasLoading && <Skeleton className="h-32 w-full rounded-xl" />}

        {images.length > 0 && (
          <div>
            <SectionHeading>Photos · {images.length}</SectionHeading>
            <MediaGrid items={images} />
          </div>
        )}

        {sketches.length > 0 && (
          <div>
            <SectionHeading>Sketches · {sketches.length}</SectionHeading>
            <MediaGrid items={sketches} />
          </div>
        )}

        {videos.length > 0 && (
          <div>
            <SectionHeading>Videos · {videos.length}</SectionHeading>
            <MediaGrid items={videos} />
          </div>
        )}

        {audios.length > 0 && (
          <div>
            <SectionHeading>Voice memos · {audios.length}</SectionHeading>
            <div className="space-y-2">
              {audios.map((m) => (
                <VoiceMemoPlayer key={m.id} src={m.url} />
              ))}
            </div>
          </div>
        )}

        {!ideasLoading && allMedia.length === 0 && (
          <p className="text-xs text-center py-4" style={{ color: "var(--muted-foreground)" }}>
            No media captured this day
          </p>
        )}
      </main>
    </div>
  );
}
