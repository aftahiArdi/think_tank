"use client";

import useSWR from "swr";

// Matches youtube.com/watch?v=, youtu.be/, youtube.com/shorts/, m.youtube.com/watch?v=
const YT_REGEX =
  /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function extractYouTubeVideoId(text: string): string | null {
  const match = YT_REGEX.exec(text);
  return match ? match[1] : null;
}

interface YTMeta {
  title: string;
  author_name: string;
  thumbnail_url: string;
}

async function fetchYTMeta(videoId: string): Promise<YTMeta> {
  const res = await fetch(`/api/yt-preview?v=${videoId}`);
  if (!res.ok) throw new Error("not found");
  return res.json();
}

interface YouTubePreviewProps {
  content: string;
  /** Stop click from bubbling to parent card/link */
  stopPropagation?: boolean;
}

export function YouTubePreview({ content, stopPropagation }: YouTubePreviewProps) {
  const videoId = extractYouTubeVideoId(content);

  const { data } = useSWR<YTMeta>(
    videoId ? `yt-${videoId}` : null,
    () => fetchYTMeta(videoId!),
    { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );

  if (!videoId) return null;

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // Use YouTube's thumbnail CDN directly — shows immediately without waiting for oEmbed response
  const thumbnail = data?.thumbnail_url ?? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

  return (
    <a
      href={youtubeUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      style={{ display: "flex", textDecoration: "none" }}
    >
      <div
        className="flex items-center w-full overflow-hidden rounded-xl"
        style={{ backgroundColor: "var(--muted)", border: "1px solid var(--border)" }}
      >
        {/* Thumbnail */}
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          style={{
            width: 88,
            height: 60,
            objectFit: "cover",
            flexShrink: 0,
            backgroundColor: "#111",
          }}
        />

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0, padding: "8px 12px" }}>
          <p
            className="text-xs font-semibold"
            style={{
              color: "var(--foreground)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"],
              overflow: "hidden",
            }}
          >
            {data?.title ?? "YouTube"}
          </p>
          {data?.author_name && (
            <p
              className="text-[11px] mt-0.5 truncate"
              style={{ color: "var(--muted-foreground)" }}
            >
              {data.author_name}
            </p>
          )}
          <p className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            youtube.com
          </p>
        </div>

        {/* YouTube play icon */}
        <div style={{ flexShrink: 0, paddingRight: 12 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="5" fill="#FF0000" />
            <polygon points="10,8 16,12 10,16" fill="white" />
          </svg>
        </div>
      </div>
    </a>
  );
}
