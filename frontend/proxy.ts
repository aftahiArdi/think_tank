import { NextRequest, NextResponse } from "next/server";

const SECRET = process.env.COOKIE_SECRET || "default-secret-change-me";

/**
 * Verify the auth cookie and extract the username.
 * Cookie format: "<username>.<hmac_hex_of_username>"
 * Returns the username if valid, null otherwise.
 */
async function verifyToken(token: string): Promise<string | null> {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 1) return null;

  const username = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);

  if (!username) return null;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(username));
  const expected = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expected === sig ? username : null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    pathname === "/icon.svg" ||
    pathname.startsWith("/icon-") ||
    pathname === "/apple-touch-icon.png"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("think_tank_auth");
  const username = token ? await verifyToken(token.value) : null;

  if (!username) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Inject username into request headers — readable by /api/flask/[...path]/route.ts
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-think-tank-user", username);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
