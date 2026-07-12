import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, categories, periodCloses, transactions } from "@/lib/schema";

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

export function normalizePattern(description: string) {
  const text = description.toLowerCase().trim().replace(/\s+/g, " ");
  const parts = text.split(/[^a-z0-9]+/).filter((p) => p.length >= 3);
  if (!parts.length) return text.slice(0, 64);
  return parts.slice(0, 3).join(" ").slice(0, 128);
}

export function categoryOut(c: {
  id: string;
  name: string;
  slug: string;
  type: string;
  isSystem: boolean;
}) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    type: c.type,
    is_system: c.isSystem,
  };
}

export async function getCategoryById(id: string) {
  const rows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  return rows[0] || null;
}

export async function assertCategoryUsable(orgId: string, categoryId: string) {
  const cat = await getCategoryById(categoryId);
  if (!cat) throw new Error("Category not found");
  if (cat.organizationId && cat.organizationId !== orgId) {
    throw new Error("Category not found");
  }
  return cat;
}

export function periodBounds(periodKey: string) {
  const [y, m] = periodKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export async function isPeriodLocked(orgId: string, day: string) {
  const key = day.slice(0, 7);
  const row = await db
    .select()
    .from(periodCloses)
    .where(and(eq(periodCloses.organizationId, orgId), eq(periodCloses.periodKey, key)))
    .limit(1);
  return !!row[0];
}

export async function assertNotLockedForTx(orgId: string, txDate: string) {
  if (await isPeriodLocked(orgId, txDate)) {
    throw new Error(`Period ${txDate.slice(0, 7)} is locked`);
  }
}

export async function getReviewStatus(orgId: string, periodStart: string, periodEnd: string) {
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        sqlBetween(transactions.transactionDate, periodStart, periodEnd)
      )
    );
  const total = rows.length;
  const needs = rows.filter((r) => r.needsReview).length;
  const sameMonth =
    periodStart.slice(0, 7) === periodEnd.slice(0, 7) ? periodStart.slice(0, 7) : null;
  let locked = false;
  if (sameMonth) {
    const pc = await db
      .select()
      .from(periodCloses)
      .where(and(eq(periodCloses.organizationId, orgId), eq(periodCloses.periodKey, sameMonth)))
      .limit(1);
    locked = !!pc[0];
  }
  return {
    period_start: periodStart,
    period_end: periodEnd,
    transaction_count: total,
    needs_review_count: needs,
    reviewed_count: Math.max(total - needs, 0),
    is_locked: locked,
    can_export: needs === 0 && total > 0,
    period_key: sameMonth,
  };
}

function sqlBetween(col: typeof transactions.transactionDate, start: string, end: string) {
  return and(gte(col, start), lte(col, end));
}

export function buildRuleSuggestion(description: string, category: { id: string; name: string }, merchantName?: string | null) {
  const pattern = normalizePattern(description);
  return {
    pattern,
    category_id: category.id,
    category_name: category.name,
    preview: description.slice(0, 120),
    merchant_name: merchantName || pattern.replace(/\b\w/g, (c) => c.toUpperCase()),
  };
}

export async function writeAudit(opts: {
  organizationId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  clientId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}) {
  await db.insert(auditLogs).values({
    organizationId: opts.organizationId,
    userId: opts.userId,
    clientId: opts.clientId || null,
    action: opts.action,
    entityType: opts.entityType,
    entityId: opts.entityId || null,
    beforeJson: opts.before ?? null,
    afterJson: opts.after ?? null,
    metaJson: opts.meta ?? null,
    ipAddress: opts.ip || null,
    userAgent: opts.userAgent || null,
  });
}

export type TxRow = typeof transactions.$inferSelect;

export function serializeTransaction(
  t: TxRow,
  catMap: Record<string, { id: string; name: string; slug: string; type: string; isSystem: boolean }>,
  extras?: { rule_suggestion?: ReturnType<typeof buildRuleSuggestion> | null }
) {
  const cat = t.categoryId ? catMap[t.categoryId] : null;
  let sourceMeta: Record<string, unknown> | null = null;
  if (t.sourceMetaJson) {
    if (typeof t.sourceMetaJson === "string") {
      try {
        sourceMeta = JSON.parse(t.sourceMetaJson) as Record<string, unknown>;
      } catch {
        sourceMeta = null;
      }
    } else if (typeof t.sourceMetaJson === "object") {
      sourceMeta = t.sourceMetaJson as Record<string, unknown>;
    }
  }
  return {
    id: t.id,
    document_id: t.documentId,
    transaction_date: t.transactionDate,
    description: t.description,
    debit: t.debit,
    credit: t.credit,
    balance: t.balance,
    reference: t.reference,
    category_id: t.categoryId,
    category: cat ? categoryOut(cat) : null,
    confidence_score: t.confidenceScore,
    needs_review: t.needsReview,
    page_number: t.pageNumber,
    extraction_source: t.extractionSource,
    source_meta: sourceMeta,
    suggested_category: null,
    rule_suggestion: extras?.rule_suggestion ?? null,
  };
}

export async function loadCategoryMap(orgId: string) {
  const rows = await db
    .select()
    .from(categories)
    .where(or(isNull(categories.organizationId), eq(categories.organizationId, orgId)));
  return Object.fromEntries(rows.map((c) => [c.id, c]));
}

export const KNOWN_AUDIT_ACTIONS = [
  "auth.login",
  "auth.signup",
  "auth.logout",
  "document.upload",
  "document.delete",
  "document.reprocess",
  "transaction.category_changed",
  "transaction.review_cleared",
  "transaction.bulk_action",
  "category.create",
  "category.update",
  "category.delete",
  "rule.upsert",
  "rule.update",
  "rule.delete",
  "period.lock",
  "period.unlock",
  "merchant.create",
  "merchant.learn",
  "merchant.delete",
  "report.export",
  "report.export_forced",
];
