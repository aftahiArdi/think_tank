import { NextRequest } from "next/server";
import http from "node:http";

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

  const body =
    req.method === "GET" || req.method === "HEAD"
      ? null
      : Buffer.from(await req.arrayBuffer());

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
    if (body) upstream.write(body);
    upstream.end();
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
