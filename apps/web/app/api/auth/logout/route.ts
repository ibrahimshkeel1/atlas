import { NextRequest, NextResponse } from "next/server";
import { clearAuthCookies, getAccessToken } from "@/lib/auth-cookies";
import { getApiUrl } from "@/lib/api";

export async function POST(req: NextRequest) {
  const token = await getAccessToken();
  if (token) {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      const ua = req.headers.get("user-agent");
      if (ua) headers["User-Agent"] = ua;
      const forwarded = req.headers.get("x-forwarded-for");
      if (forwarded) headers["X-Forwarded-For"] = forwarded;
      await fetch(`${getApiUrl()}/api/v1/auth/logout`, {
        method: "POST",
        headers,
      });
    } catch {
      // Still clear cookies even if audit logout fails
    }
  }
  await clearAuthCookies();
  return NextResponse.json({ ok: true });
}
