import { NextRequest } from "next/server";
import http from "node:http";

function proxyRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | null
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 500,
            headers: (res.headers || {}) as Record<string, string>,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function proxy(req: NextRequest) {
  const apiUrl = process.env.API_URL || "http://localhost:6000";
  const path = req.nextUrl.pathname.replace(/^\/api\/flask/, "");
  const url = `${apiUrl}${path}${req.nextUrl.search}`;

  const headers: Record<string, string> = {};
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;

  const body =
    req.method === "GET" || req.method === "HEAD"
      ? null
      : Buffer.from(await req.arrayBuffer());

  const res = await proxyRequest(url, req.method, headers, body);

  const responseHeaders = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (v && k !== "transfer-encoding") responseHeaders.set(k, String(v));
  }

  return new Response(new Uint8Array(res.body), {
    status: res.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
