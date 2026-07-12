import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/auth-cookies";

/**
 * Returns the access JWT for browser → API direct calls (e.g. large PDF uploads).
 * Needed on Vercel where the BFF proxy has a ~4.5MB body limit.
 */
export async function GET() {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ access_token: token });
}
