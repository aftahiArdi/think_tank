import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const username = request.headers.get("x-think-tank-user");
  if (!username) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ username });
}
