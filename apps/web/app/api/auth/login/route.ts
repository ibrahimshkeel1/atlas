import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth-cookies";
import { getApiUrl } from "@/lib/api";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${getApiUrl()}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }
  await setAuthCookies(data.access_token, data.refresh_token);
  return NextResponse.json({ ok: true });
}
