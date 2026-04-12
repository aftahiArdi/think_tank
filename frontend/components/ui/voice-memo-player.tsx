"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Play, Pause } from "lucide-react";

// Deterministic fake waveform from a seed string
function generateBars(count: number, seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return Array.from({ length: count }, (_, i) => {
    const v = Math.abs(Math.sin(h * 0.001 + i * 0.43) * Math.cos(i * 0.17 + h * 0.0007));
    // Bias toward middle heights, taper at edges
    const edge = 1 - Math.abs((i / count) * 2 - 1) * 0.3;
    return (0.15 + v * 0.85) * edge;
  });
}

function fmt(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const BAR_COUNT = 48;

export function VoiceMemoPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = generateBars(BAR_COUNT, src);

  const progress = duration > 0 ? currentTime / duration : 0;

  // RAF loop for smooth waveform update while playing
  const tick = useCallback(() => {
    const audio = audioRef.current;
    if (audio) setCurrentTime(audio.currentTime);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onMeta = () => setDuration(audio.duration);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };

    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnded);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    } else {
      await audio.play();
      setPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  const seek = (pct: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const t = pct * duration;
    audio.currentTime = t;
    setCurrentTime(t);
  };

  const handleWaveformTap = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    seek((clientX - rect.left) / rect.width);
  };

  return (
    <div
      className="rounded-2xl p-4 select-none"
      style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Waveform — tappable to seek */}
      <div
        className="flex items-center gap-px h-14 mb-4 cursor-pointer"
        onClick={handleWaveformTap}
        onTouchStart={handleWaveformTap}
        style={{ touchAction: "none" }}
      >
        {bars.map((h, i) => {
          const barPct = i / BAR_COUNT;
          const active = barPct <= progress;
          // Playing bars near cursor pulse slightly
          const nearCursor = Math.abs(barPct - progress) < 0.04;
          return (
            <div
              key={i}
              className="flex-1 rounded-full"
              style={{
                height: `${h * 100}%`,
                backgroundColor: active
                  ? "var(--primary)"
                  : "var(--muted)",
                opacity: active ? 1 : nearCursor && playing ? 0.7 : 0.45,
                transition: "background-color 0.1s, opacity 0.1s",
              }}
            />
          );
        })}
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-4">
        {/* Play/pause */}
        <button
          onClick={toggle}
          className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
          style={{
            backgroundColor: "var(--primary)",
            boxShadow: playing ? "0 0 0 4px color-mix(in srgb, var(--primary) 25%, transparent)" : "none",
            transition: "box-shadow 0.2s, transform 0.1s",
          }}
        >
          {playing
            ? <Pause size={20} fill="var(--primary-foreground)" strokeWidth={0} style={{ color: "var(--primary-foreground)" }} />
            : <Play size={20} fill="var(--primary-foreground)" strokeWidth={0} style={{ marginLeft: 2, color: "var(--primary-foreground)" }} />}
        </button>

        {/* Time + scrub */}
        <div className="flex-1 space-y-1.5 min-w-0">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.05}
            value={currentTime}
            onChange={(e) => seek(Number(e.target.value) / (duration || 1))}
            className="w-full"
            style={{ accentColor: "var(--primary)", height: 4, cursor: "pointer" }}
          />
          <div className="flex justify-between text-[11px] tabular-nums" style={{ color: "var(--muted-foreground)" }}>
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
