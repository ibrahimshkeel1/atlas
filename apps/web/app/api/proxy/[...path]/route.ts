import { NextRequest, NextResponse } from "next/server";
import { requireUser, jsonError } from "@/lib/session";
import * as api from "@/lib/atlas-api";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, pathSegments: string[]) {
  const path = pathSegments.join("/");
  const method = req.method.toUpperCase();

  try {
    // Public auth is handled by /api/auth/* — proxy is authenticated API

    if (path === "auth/me" && method === "GET") {
      const user = await requireUser(req);
      return NextResponse.json(await api.me(user));
    }

    const user = await requireUser(req);

    if (path === "documents" && method === "GET") {
      return NextResponse.json(await api.listDocuments(user));
    }
    if (path === "documents/upload" && method === "POST") {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return jsonError("file required");
      const force = new URL(req.url).searchParams.get("force") === "true";
      try {
        return NextResponse.json(await api.uploadDocument(user, file, force), { status: 201 });
      } catch (e) {
        const err = e as Error & { status?: number };
        return jsonError(err.message, err.status || 400);
      }
    }
    if (path.startsWith("documents/") && method === "DELETE") {
      const id = path.split("/")[1];
      await api.deleteDocument(user, id);
      return new NextResponse(null, { status: 204 });
    }
    if (path.match(/^documents\/[^/]+\/reprocess$/) && method === "POST") {
      const id = path.split("/")[1];
      return NextResponse.json(await api.reprocessDocument(user, id));
    }
    if (path === "transactions" && method === "GET") {
      return NextResponse.json(await api.listTransactions(user, new URL(req.url).searchParams));
    }
    if (path === "categories" && method === "GET") {
      return NextResponse.json(await api.listCategories(user));
    }
    if (path === "dashboard/summary" && method === "GET") {
      return NextResponse.json(await api.dashboardSummary(user));
    }

    return jsonError(`Not implemented on Vercel yet: ${method} /${path}`, 501);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Request failed";
    if (msg === "Unauthorized" || msg.includes("Invalid token")) {
      return jsonError("Unauthorized", 401);
    }
    return jsonError(msg, 500);
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
