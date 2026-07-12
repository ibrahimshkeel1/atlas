import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth-cookies";
import { signup } from "@/lib/atlas-api";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = await signup(body);
    await setAuthCookies(data.access_token, data.refresh_token);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "Signup failed" },
      { status: 400 }
    );
  }
}
