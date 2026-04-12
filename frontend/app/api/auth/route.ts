import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import http from "node:http";

const SECRET = process.env.COOKIE_SECRET || "default-secret-change-me";
const API_URL = process.env.API_URL || "http://localhost:6000";

async function signUsername(username: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(username));
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${username}.${sigHex}`;
}

function httpPost(url: string, body: string): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode || 500, data: Buffer.concat(chunks).toString() })
        );
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";

  if (!username || !password) {
    return NextResponse.json({ error: "Missing username or password" }, { status: 400 });
  }

  const res = await httpPost(
    `${API_URL}/auth/login`,
    JSON.stringify({ username, password })
  );

  if (res.status !== 200) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await signUsername(username);
  const jar = await cookies();

  jar.set("think_tank_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });

  // Non-HttpOnly: JS-readable username for client-side biometric key scoping.
  // Not a secret — the real auth token stays HttpOnly.
  jar.set("think_tank_user", username, {
    httpOnly: false,
    sameSite: "lax",
    secure: false,
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });

  return NextResponse.json({ success: true });
}
