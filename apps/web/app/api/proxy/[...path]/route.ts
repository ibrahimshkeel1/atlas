import { NextRequest, NextResponse } from "next/server";
import { requireUser, jsonError } from "@/lib/session";
import * as api from "@/lib/atlas-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ path: string[] }> };

function normalizePath(segments: string[]) {
  return segments.map((s) => decodeURIComponent(s)).join("/").replace(/\/+$/, "");
}

async function handle(req: NextRequest, pathSegments: string[]) {
  const path = normalizePath(pathSegments);
  const method = req.method.toUpperCase();
  const port = await import("@/lib/atlas-port");

  try {
    if (path === "auth/me" && method === "GET") {
      const user = await requireUser(req);
      return NextResponse.json(await api.me(user));
    }

    const user = await requireUser(req);

    // Documents
    if (path === "documents" && method === "GET") {
      const clientId = new URL(req.url).searchParams.get("client_id");
      return NextResponse.json(await api.listDocuments(user, clientId));
    }
    if (path === "documents/upload" && method === "POST") {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return jsonError("file required");
      const sp = new URL(req.url).searchParams;
      const force = sp.get("force") === "true";
      const clientId = sp.get("client_id");
      try {
        return NextResponse.json(await api.uploadDocument(user, file, force, clientId), {
          status: 201,
        });
      } catch (e) {
        const err = e as Error & { status?: number };
        return jsonError(err.message, err.status || 400);
      }
    }
    if (path.match(/^documents\/[^/]+$/) && method === "GET") {
      const id = path.split("/")[1];
      return NextResponse.json(await port.getDocument(user, id));
    }
    if (path.match(/^documents\/[^/]+\/file$/) && method === "GET") {
      const id = path.split("/")[1];
      const bytes = await port.getDocumentFile(user, id);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": "inline",
          "Cache-Control": "private, max-age=60",
        },
      });
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

    // Transactions
    if (path === "transactions" && method === "GET") {
      return NextResponse.json(await port.listTransactionsExtended(user, new URL(req.url).searchParams));
    }
    if (path.match(/^transactions\/[^/]+$/) && method === "PATCH") {
      const id = path.split("/")[1];
      const body = await req.json();
      return NextResponse.json(await port.updateTransaction(user, id, body));
    }
    if (path === "transactions/bulk-category" && method === "POST") {
      return NextResponse.json(await port.bulkCategory(user, await req.json()));
    }
    if (path === "transactions/bulk-review" && method === "POST") {
      return NextResponse.json(await port.bulkReview(user, await req.json()));
    }
    if (path === "transactions/bulk-approve-high-confidence" && method === "POST") {
      return NextResponse.json(await port.bulkApproveHighConfidence(user, await req.json()));
    }

    // Categories
    if (path === "categories" && method === "GET") {
      return NextResponse.json(await api.listCategories(user));
    }
    if (path === "categories" && method === "POST") {
      return NextResponse.json(await port.createCategory(user, await req.json()), { status: 201 });
    }
    if (path.match(/^categories\/[^/]+$/) && method === "PATCH") {
      const id = path.split("/")[1];
      return NextResponse.json(await port.updateCategoryApi(user, id, await req.json()));
    }
    if (path.match(/^categories\/[^/]+$/) && method === "DELETE") {
      const id = path.split("/")[1];
      const reassign = new URL(req.url).searchParams.get("reassign_to_id");
      return NextResponse.json(await port.deleteCategoryApi(user, id, reassign));
    }

    // Rules
    if (path === "rules" && method === "GET") {
      return NextResponse.json(await port.listRules(user));
    }
    if (path === "rules" && method === "POST") {
      return NextResponse.json(await port.createRule(user, await req.json()), { status: 201 });
    }
    if (path.match(/^rules\/[^/]+$/) && method === "PATCH") {
      const id = path.split("/")[1];
      return NextResponse.json(await port.updateRule(user, id, await req.json()));
    }
    if (path.match(/^rules\/[^/]+$/) && method === "DELETE") {
      const id = path.split("/")[1];
      await port.deleteRule(user, id);
      return new NextResponse(null, { status: 204 });
    }

    // Review / close
    if (path === "review/status" && method === "GET") {
      const sp = new URL(req.url).searchParams;
      return NextResponse.json(
        await port.reviewStatusForUser(user, sp.get("period_start") || undefined, sp.get("period_end") || undefined)
      );
    }
    if (path === "close" && method === "GET") {
      return NextResponse.json(await port.listPeriodCloses(user));
    }
    if (path === "close" && method === "POST") {
      const body = await req.json();
      return NextResponse.json(await port.lockPeriod(user, body.period_key));
    }
    if (path.match(/^close\/[^/]+\/status$/) && method === "GET") {
      const key = path.split("/")[1];
      const { start, end } = (await import("@/lib/atlas-helpers")).periodBounds(key);
      return NextResponse.json(await port.reviewStatusForUser(user, start, end));
    }
    if (path.match(/^close\/[^/]+$/) && method === "DELETE") {
      const key = path.split("/")[1];
      await port.unlockPeriod(user, key);
      return new NextResponse(null, { status: 204 });
    }

    // Reports
    if (path === "reports/bounds" && method === "GET") {
      return NextResponse.json(await port.reportBounds(user));
    }
    if (path === "reports/summary" && method === "GET") {
      const sp = new URL(req.url).searchParams;
      const start = sp.get("period_start");
      const end = sp.get("period_end");
      if (!start || !end) return jsonError("period_start and period_end required", 400);
      return NextResponse.json(await port.reportSummary(user, start, end));
    }
    if (path === "reports/export" && method === "POST") {
      return NextResponse.json(await port.exportReport(user, await req.json()));
    }

    // Clients
    if (path === "clients" && method === "GET") {
      return NextResponse.json(await port.listClientsApi(user));
    }
    if (path === "clients" && method === "POST") {
      return NextResponse.json(await port.createClientApi(user, await req.json()), { status: 201 });
    }

    // Merchants
    if (path === "merchants" && method === "GET") {
      return NextResponse.json(await port.listMerchantsApi(user));
    }
    if (path === "merchants" && method === "POST") {
      return NextResponse.json(await port.createMerchantApi(user, await req.json()), { status: 201 });
    }
    if (path === "merchants/learn" && method === "POST") {
      return NextResponse.json(await port.learnMerchantApi(user, await req.json()));
    }
    if (path.match(/^merchants\/[^/]+$/) && method === "DELETE") {
      const id = path.split("/")[1];
      return NextResponse.json(await port.deleteMerchantApi(user, id));
    }

    // Audit
    if (path === "audit-logs/filters" && method === "GET") {
      return NextResponse.json(await port.auditLogFilters(user));
    }
    if (path === "audit-logs" && method === "GET") {
      return NextResponse.json(await port.listAuditLogs(user, new URL(req.url).searchParams));
    }

    // Dashboard
    if (path === "dashboard/summary" && method === "GET") {
      return NextResponse.json(await port.enhancedDashboardSummary(user));
    }

    // Eval / banks / accuracy stubs
    if (path === "banks" && method === "GET") {
      return NextResponse.json(await port.listBanks());
    }
    if (path === "eval/bank-parsers" && method === "GET") {
      return NextResponse.json(await port.evalBankParsersRun());
    }
    if (path === "eval/bank-parsers/run" && method === "POST") {
      return NextResponse.json(await port.evalBankParsersRun());
    }
    if (path === "eval/latest" && method === "GET") {
      return NextResponse.json(await port.evalLatest());
    }
    if (path === "eval/runs" && method === "GET") {
      return NextResponse.json(await port.evalRuns());
    }
    if (path === "eval/run" && method === "POST") {
      return NextResponse.json(await port.evalRun());
    }
    if (path === "accuracy/categorization" && method === "GET") {
      return NextResponse.json(await port.accuracyCategorization(user));
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
