import { NextRequest } from "next/server";
import http from "node:http";
import { Readable } from "node:stream";

const BINARY_CONTENT_TYPE = /^(image|video|audio)\//;

async function proxy(req: NextRequest) {
  const apiUrl = process.env.API_URL || "http://localhost:6000";
  const path = req.nextUrl.pathname.replace(/^\/api\/flask/, "");
  const url = `${apiUrl}${path}${req.nextUrl.search}`;

  const headers: Record<string, string> = {};
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;

  // Forward user identity injected by middleware
  const user = req.headers.get("x-think-tank-user");
  if (user) headers["x-think-tank-user"] = user;

  const cl = req.headers.get("content-length");
  if (cl) headers["content-length"] = cl;

  // Forward range headers — required for video seeking (206 Partial Content)
  const range = req.headers.get("range");
  if (range) headers["range"] = range;
  const ifRange = req.headers.get("if-range");
  if (ifRange) headers["if-range"] = ifRange;

  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== null;

  const parsed = new URL(url);

  return new Promise<Response>((resolve, reject) => {
    const upstream = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: req.method,
        headers,
      },
      (res) => {
        const responseHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v && k !== "transfer-encoding") responseHeaders.set(k, String(v));
        }

        const contentType = (res.headers["content-type"] as string) || "";

        if (BINARY_CONTENT_TYPE.test(contentType)) {
          // Long-lived cache: uploads are immutable (ideaId-prefixed filenames never reuse)
          responseHeaders.set("cache-control", "public, max-age=31536000, immutable");
          // Remove Next.js RSC vary headers — they fragment the browser media cache
          responseHeaders.delete("vary");

          // Stream binary content (images, video) — no buffering
          const stream = new ReadableStream({
            start(controller) {
              res.on("data", (chunk: Buffer) =>
                controller.enqueue(new Uint8Array(chunk))
              );
              res.on("end", () => controller.close());
              res.on("error", (err) => controller.error(err));
            },
          });
          resolve(
            new Response(stream, {
              status: res.statusCode || 500,
              headers: responseHeaders,
            })
          );
        } else {
          // Buffer JSON/text responses (small, safe to collect)
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve(
              new Response(new Uint8Array(Buffer.concat(chunks)), {
                status: res.statusCode || 500,
                headers: responseHeaders,
              })
            );
          });
        }

        res.on("error", reject);
      }
    );

    upstream.on("error", reject);
    if (hasBody && req.body) {
      // Stream request body directly — no in-memory buffering (required for large video uploads)
      Readable.fromWeb(req.body as import("node:stream/web").ReadableStream<Uint8Array>).pipe(upstream);
    } else {
      upstream.end();
    }
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
