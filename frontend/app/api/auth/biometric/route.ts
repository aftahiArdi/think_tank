import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

const SECRET = process.env.COOKIE_SECRET || "default-secret-change-me";

function signToken(): string {
  const payload = Date.now().toString();
  const hmac = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

export async function POST() {
  const token = signToken();
  const response = NextResponse.json({ success: true });

  (await cookies()).set("think_tank_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });

  return response;
}
