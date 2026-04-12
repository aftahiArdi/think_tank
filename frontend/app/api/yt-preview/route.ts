import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("v");
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: "invalid video id" }, { status: 400 });
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

  try {
    const res = await fetch(oembedUrl, {
      next: { revalidate: 3600 }, // cache 1 hour
      headers: { "User-Agent": "ThinkTank/1.0" },
    });
    if (!res.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    const data = await res.json();
    return NextResponse.json(
      {
        title: data.title as string,
        author_name: data.author_name as string,
        thumbnail_url: data.thumbnail_url as string,
      },
      {
        headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
      }
    );
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
