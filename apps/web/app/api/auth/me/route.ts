import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/auth-cookies";
import { requireUser } from "@/lib/session";
import { me } from "@/lib/atlas-api";

export async function GET() {
  try {
    const token = await getAccessToken();
    if (!token) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    const user = await requireUser();
    return NextResponse.json(await me(user));
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
}
