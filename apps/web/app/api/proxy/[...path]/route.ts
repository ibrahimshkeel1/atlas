import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/auth-cookies";
import { getApiUrl } from "@/lib/api";

/** Allow longer upstream calls (export, reprocess) on Vercel Pro. */
export const maxDuration = 60;

async function proxy(req: NextRequest, pathSegments: string[]) {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const path = "/" + pathSegments.join("/");
  const url = new URL(req.url);
  const target = `${getApiUrl()}/api/v1${path}${url.search}`;
  const contentType = req.headers.get("content-type") || "";

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);

  const init: RequestInit = { method: req.method, headers };

  if (req.method !== "GET" && req.method !== "HEAD") {
    if (contentType.includes("multipart/form-data")) {
      // Rebuild FormData so boundary is correct for the upstream request
      const incoming = await req.formData();
      const outbound = new FormData();
      incoming.forEach((value, key) => outbound.append(key, value));
      init.body = outbound;
    } else {
      if (contentType) headers.set("Content-Type", contentType);
      init.body = await req.text();
    }
  }

  const res = await fetch(target, init);
  const buf = await res.arrayBuffer();
  const outHeaders = new Headers();
  const resType = res.headers.get("content-type");
  if (resType) outHeaders.set("content-type", resType);
  return new NextResponse(buf, { status: res.status, headers: outHeaders });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
