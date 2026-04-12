import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

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

export async function POST(request: NextRequest) {
  const body = await request.json();
  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";

  if (!username || !password) {
    return NextResponse.json({ error: "Missing username or password" }, { status: 400 });
  }

  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await signUsername(username);

  (await cookies()).set("think_tank_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: "/",
  });

  return NextResponse.json({ success: true });
}
