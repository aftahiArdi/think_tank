"use client";

import useSWR from "swr";
import { useInView } from "@/lib/hooks/use-in-view";

const URL_REGEX = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;

function extractFirstNonYouTubeUrl(text: string): string | null {
  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(text)) !== null) {
    const url = match[0];
    if (!/youtube\.com|youtu\.be/i.test(url)) return url;
  }
  return null;
}

interface MicrolicMeta {
  title: string | null;
  description: string | null;
  image: string | null;
  hostname: string;
}

async function fetchMeta(url: string): Promise<MicrolicMeta> {
  const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
  const json = await res.json();
  const d = json?.data;
  return {
    title: d?.title ?? null,
    description: d?.description ?? null,
    image: d?.image?.url ?? d?.logo?.url ?? null,
    hostname: new URL(url).hostname.replace(/^www\./, ""),
  };
}

interface LinkPreviewProps {
  content: string;
  stopPropagation?: boolean;
}

export function LinkPreview({ content, stopPropagation }: LinkPreviewProps) {
  const url = extractFirstNonYouTubeUrl(content);
  // Only fire the microlink call once this card is near the viewport. Without
  // this, a 30-card feed mount triggers up to 30 parallel external fetches
  // before the user has even scrolled.
  const { ref, inView } = useInView<HTMLAnchorElement>("300px 0px");

  const { data } = useSWR<MicrolicMeta>(
    url && inView ? `link-${url}` : null,
    () => fetchMeta(url!),
    { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );

  if (!url) return null;

  const hostname = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
  })();

  return (
    <a
      ref={ref}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      style={{ display: "flex", textDecoration: "none" }}
    >
      <div
        className="flex items-center w-full overflow-hidden rounded-xl"
        style={{ backgroundColor: "var(--muted)", border: "1px solid var(--border)" }}
      >
        {data?.image && (
          <img
            src={data.image}
            alt=""
            loading="lazy"
            style={{
              width: 72,
              height: 60,
              objectFit: "cover",
              flexShrink: 0,
              backgroundColor: "var(--card)",
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0, padding: "8px 12px" }}>
          <p
            className="text-xs font-semibold truncate"
            style={{ color: "var(--foreground)" }}
          >
            {data?.title ?? hostname}
          </p>
          {data?.description && (
            <p
              className="text-[11px] mt-0.5"
              style={{
                color: "var(--muted-foreground)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"],
                overflow: "hidden",
              }}
            >
              {data.description}
            </p>
          )}
          <p className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            {data?.hostname ?? hostname}
          </p>
        </div>
      </div>
    </a>
  );
}
