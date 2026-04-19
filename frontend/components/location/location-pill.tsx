"use client";

import { MapPin } from "lucide-react";

interface LocationPillProps {
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  stopPropagation?: boolean;
}

export function LocationPill({
  latitude,
  longitude,
  locationName,
  stopPropagation,
}: LocationPillProps) {
  if (latitude === null || longitude === null) return null;

  const label = locationName ?? "Locating…";
  const mapsHref = `https://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(
    locationName ?? "Idea",
  )}`;

  return (
    <a
      href={mapsHref}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      onPointerDown={stopPropagation ? (e) => e.stopPropagation() : undefined}
      onTouchStart={stopPropagation ? (e) => e.stopPropagation() : undefined}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium max-w-full"
      style={{
        backgroundColor: "var(--muted)",
        color: "var(--muted-foreground)",
        opacity: locationName ? 1 : 0.65,
      }}
    >
      <MapPin size={10} style={{ flexShrink: 0 }} />
      <span className="truncate">{label}</span>
    </a>
  );
}
