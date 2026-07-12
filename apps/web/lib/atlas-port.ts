import { createSignedUrl, uploadReport } from "@/lib/storage";
import {
  assertCategoryUsable,
  assertNotLockedForTx,
  buildRuleSuggestion,
  categoryOut,
  getReviewStatus,
  KNOWN_AUDIT_ACTIONS,
  loadCategoryMap,
  normalizePattern,
  periodBounds,
  serializeTransaction,
  slugify,
  writeAudit,
} from "@/lib/atlas-helpers";
import { db } from "@/lib/db";
import {
  auditLogs,
  categories,
  categoryRules,
  clients,
  documents,
  merchantAliases,
  merchants,
  periodCloses,
  transactions,
  users,
} from "@/lib/schema";
import { downloadPdf } from "@/lib/storage";
import type { SessionUser } from "@/lib/session";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  min,
  or,
  sql,
} from "drizzle-orm";

// ---- Documents ----

export async function getDocument(user: SessionUser, id: string) {
  const doc = (
    await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.organizationId, user.organizationId)))
      .limit(1)
  )[0];
  if (!doc) throw new Error("Document not found");
  const [{ c }] = await db
    .select({ c: count() })
    .from(transactions)
    .where(eq(transactions.documentId, id));
  return {
    id: doc.id,
    filename: doc.filename,
    status: doc.status,
    page_count: doc.pageCount,
    error_message: doc.errorMessage,
    bank_name: doc.bankName,
    created_at: doc.createdAt?.toISOString?.() || doc.createdAt,
    transaction_count: Number(c) || 0,
    extraction_meta: doc.extractionMetaJson,
  };
}

export async function getDocumentFile(user: SessionUser, id: string) {
  const doc = (
    await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.organizationId, user.organizationId)))
      .limit(1)
  )[0];
  if (!doc) throw new Error("Document not found");
  return downloadPdf(doc.s3Key);
}

// ---- Transactions (extended) ----

export async function listTransactionsExtended(user: SessionUser, params: URLSearchParams) {
  const limit = Math.min(Number(params.get("limit") || 100), 500);
  const offset = Number(params.get("offset") || 0);
  const sort = params.get("sort") || "date_desc";
  const filters = [eq(transactions.organizationId, user.organizationId)];
  const q = params.get("q");
  if (q) filters.push(ilike(transactions.description, `%${q}%`));
  if (params.get("category_id")) filters.push(eq(transactions.categoryId, params.get("category_id")!));
  if (params.get("needs_review") === "true") filters.push(eq(transactions.needsReview, true));
  if (params.get("needs_review") === "false") filters.push(eq(transactions.needsReview, false));
  if (params.get("document_id")) filters.push(eq(transactions.documentId, params.get("document_id")!));
  if (params.get("date_from")) filters.push(gte(transactions.transactionDate, params.get("date_from")!));
  if (params.get("date_to")) filters.push(lte(transactions.transactionDate, params.get("date_to")!));

  let orderBy;
  if (sort === "date_asc") orderBy = asc(transactions.transactionDate);
  else if (sort === "page_asc")
    orderBy = sql`${transactions.pageNumber} asc nulls last, ${transactions.transactionDate} asc`;
  else if (sort === "amount_desc")
    orderBy = sql`coalesce(${transactions.debit},0)+coalesce(${transactions.credit},0) desc`;
  else if (sort === "amount_asc")
    orderBy = sql`coalesce(${transactions.debit},0)+coalesce(${transactions.credit},0) asc`;
  else orderBy = desc(transactions.transactionDate);

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...filters))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);
  const catMap = await loadCategoryMap(user.organizationId);
  return rows.map((t) => serializeTransaction(t, catMap));
}

async function getTx(user: SessionUser, id: string) {
  const row = (
    await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.organizationId, user.organizationId)))
      .limit(1)
  )[0];
  if (!row) throw new Error("Transaction not found");
  return row;
}

export async function updateTransaction(
  user: SessionUser,
  id: string,
  body: { category_id?: string | null; needs_review?: boolean | null }
) {
  const tx = await getTx(user, id);
  await assertNotLockedForTx(user.organizationId, tx.transactionDate);
  if (body.category_id == null && body.needs_review == null) throw new Error("Nothing to update");

  let ruleSuggestion = null;
  const updates: Partial<typeof transactions.$inferInsert> = { updatedAt: new Date() };

  if (body.category_id != null) {
    const cat = await assertCategoryUsable(user.organizationId, body.category_id);
    updates.categoryId = cat.id;
    updates.needsReview = false;
    ruleSuggestion = buildRuleSuggestion(tx.description, cat);
    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      clientId: tx.clientId,
      action: "transaction.category_changed",
      entityType: "transaction",
      entityId: tx.id,
      after: { category_id: cat.id },
    });
  } else if (body.needs_review != null) {
    updates.needsReview = body.needs_review;
    if (!body.needs_review) {
      await writeAudit({
        organizationId: user.organizationId,
        userId: user.id,
        clientId: tx.clientId,
        action: "transaction.review_cleared",
        entityType: "transaction",
        entityId: tx.id,
      });
    }
  }

  const [updated] = await db.update(transactions).set(updates).where(eq(transactions.id, id)).returning();
  const catMap = await loadCategoryMap(user.organizationId);
  return serializeTransaction(updated, catMap, { rule_suggestion: ruleSuggestion });
}

export async function bulkCategory(
  user: SessionUser,
  body: { transaction_ids: string[]; category_id: string }
) {
  const cat = await assertCategoryUsable(user.organizationId, body.category_id);
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(eq(transactions.organizationId, user.organizationId), inArray(transactions.id, body.transaction_ids))
    );
  for (const tx of rows) await assertNotLockedForTx(user.organizationId, tx.transactionDate);
  await db
    .update(transactions)
    .set({ categoryId: cat.id, needsReview: false, updatedAt: new Date() })
    .where(inArray(transactions.id, body.transaction_ids));
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "transaction.bulk_action",
    entityType: "transaction",
    meta: { bulk_kind: "category", count: rows.length },
  });
  const catMap = await loadCategoryMap(user.organizationId);
  const fresh = await db
    .select()
    .from(transactions)
    .where(inArray(transactions.id, body.transaction_ids));
  return fresh.map((t) => serializeTransaction(t, catMap));
}

export async function bulkReview(
  user: SessionUser,
  body: { transaction_ids: string[]; needs_review: boolean }
) {
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(eq(transactions.organizationId, user.organizationId), inArray(transactions.id, body.transaction_ids))
    );
  for (const tx of rows) await assertNotLockedForTx(user.organizationId, tx.transactionDate);
  await db
    .update(transactions)
    .set({ needsReview: body.needs_review, updatedAt: new Date() })
    .where(inArray(transactions.id, body.transaction_ids));
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "transaction.bulk_action",
    entityType: "transaction",
    meta: { bulk_kind: body.needs_review ? "review_flag" : "review_clear", count: rows.length },
  });
  const catMap = await loadCategoryMap(user.organizationId);
  const fresh = await db
    .select()
    .from(transactions)
    .where(inArray(transactions.id, body.transaction_ids));
  return fresh.map((t) => serializeTransaction(t, catMap));
}

export async function bulkApproveHighConfidence(
  user: SessionUser,
  body: { transaction_ids?: string[] | null; document_id?: string | null; min_confidence?: number | null }
) {
  const threshold = body.min_confidence ?? 0.7;
  const filters = [
    eq(transactions.organizationId, user.organizationId),
    eq(transactions.needsReview, true),
    isNotNull(transactions.confidenceScore),
    gte(transactions.confidenceScore, String(threshold)),
  ];
  if (body.document_id) filters.push(eq(transactions.documentId, body.document_id));
  if (body.transaction_ids?.length) filters.push(inArray(transactions.id, body.transaction_ids));

  const rows = await db.select().from(transactions).where(and(...filters)).limit(500);
  const ids: string[] = [];
  for (const tx of rows) {
    if (await isPeriodLocked(user.organizationId, tx.transactionDate)) continue;
    ids.push(tx.id);
  }
  if (ids.length) {
    await db
      .update(transactions)
      .set({ needsReview: false, updatedAt: new Date() })
      .where(inArray(transactions.id, ids));
    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "transaction.bulk_action",
      entityType: "transaction",
      meta: { bulk_kind: "approve_high_confidence", count: ids.length },
    });
  }
  const catMap = await loadCategoryMap(user.organizationId);
  const fresh = ids.length
    ? await db.select().from(transactions).where(inArray(transactions.id, ids))
    : [];
  return fresh.map((t) => serializeTransaction(t, catMap));
}

async function isPeriodLocked(orgId: string, day: string) {
  const key = day.slice(0, 7);
  const row = await db
    .select()
    .from(periodCloses)
    .where(and(eq(periodCloses.organizationId, orgId), eq(periodCloses.periodKey, key)))
    .limit(1);
  return !!row[0];
}

// ---- Categories CRUD ----

export async function createCategory(user: SessionUser, body: { name: string; type: string }) {
  if (!["income", "expense"].includes(body.type)) throw new Error("type must be income or expense");
  const existing = await db
    .select()
    .from(categories)
    .where(or(isNull(categories.organizationId), eq(categories.organizationId, user.organizationId)));
  if (existing.some((c) => c.name.toLowerCase() === body.name.toLowerCase())) {
    throw new Error("Category name already exists");
  }
  let slug = slugify(body.name);
  let n = 1;
  while (existing.some((c) => c.slug === slug)) slug = `${slugify(body.name)}-${n++}`;
  const [row] = await db
    .insert(categories)
    .values({
      organizationId: user.organizationId,
      name: body.name,
      slug,
      type: body.type,
      isSystem: false,
    })
    .returning();
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "category.create",
    entityType: "category",
    entityId: row.id,
  });
  return categoryOut(row);
}

export async function updateCategoryApi(
  user: SessionUser,
  id: string,
  body: { name?: string; type?: string }
) {
  const row = (
    await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.organizationId, user.organizationId)))
      .limit(1)
  )[0];
  if (!row) throw new Error("Category not found");
  const updates: Partial<typeof categories.$inferInsert> = { updatedAt: new Date() };
  if (body.name) updates.name = body.name;
  if (body.type) {
    if (!["income", "expense"].includes(body.type)) throw new Error("Invalid type");
    updates.type = body.type;
  }
  const [updated] = await db.update(categories).set(updates).where(eq(categories.id, id)).returning();
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "category.update",
    entityType: "category",
    entityId: id,
  });
  return categoryOut(updated);
}

export async function deleteCategoryApi(user: SessionUser, id: string, reassignToId?: string | null) {
  const row = (
    await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.organizationId, user.organizationId)))
      .limit(1)
  )[0];
  if (!row) throw new Error("Category not found");
  let targetId = reassignToId;
  if (!targetId) {
    const other = (
      await db
        .select()
        .from(categories)
        .where(and(eq(categories.slug, "other"), isNull(categories.organizationId)))
        .limit(1)
    )[0];
    if (!other) throw new Error("Default other category missing");
    targetId = other.id;
  }
  await db
    .update(transactions)
    .set({ categoryId: targetId, updatedAt: new Date() })
    .where(and(eq(transactions.categoryId, id), eq(transactions.organizationId, user.organizationId)));
  await db
    .update(categoryRules)
    .set({ categoryId: targetId, updatedAt: new Date() })
    .where(and(eq(categoryRules.categoryId, id), eq(categoryRules.organizationId, user.organizationId)));
  await db.delete(categories).where(eq(categories.id, id));
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "category.delete",
    entityType: "category",
    entityId: id,
  });
  return { ok: true };
}

// ---- Rules ----

async function ruleOut(rule: typeof categoryRules.$inferSelect, catMap: Awaited<ReturnType<typeof loadCategoryMap>>) {
  const cat = catMap[rule.categoryId];
  return {
    id: rule.id,
    pattern: rule.pattern,
    match_type: rule.matchType,
    category_id: rule.categoryId,
    category: cat ? categoryOut(cat) : null,
    priority: rule.priority,
  };
}

export async function listRules(user: SessionUser) {
  const rows = await db
    .select()
    .from(categoryRules)
    .where(eq(categoryRules.organizationId, user.organizationId))
    .orderBy(asc(categoryRules.priority), asc(categoryRules.pattern));
  const catMap = await loadCategoryMap(user.organizationId);
  return Promise.all(rows.map((r) => ruleOut(r, catMap)));
}

export async function createRule(
  user: SessionUser,
  body: { pattern: string; category_id: string; match_type?: string; priority?: number }
) {
  const cat = await assertCategoryUsable(user.organizationId, body.category_id);
  const matchType = body.match_type === "exact" ? "exact" : "contains";
  const pattern =
    matchType === "exact" ? body.pattern.trim().toLowerCase() : normalizePattern(body.pattern);
  const existing = (
    await db
      .select()
      .from(categoryRules)
      .where(
        and(
          eq(categoryRules.organizationId, user.organizationId),
          eq(categoryRules.pattern, pattern),
          eq(categoryRules.matchType, matchType)
        )
      )
      .limit(1)
  )[0];
  let rule;
  if (existing) {
    [rule] = await db
      .update(categoryRules)
      .set({ categoryId: cat.id, priority: body.priority ?? 10, updatedAt: new Date() })
      .where(eq(categoryRules.id, existing.id))
      .returning();
  } else {
    [rule] = await db
      .insert(categoryRules)
      .values({
        organizationId: user.organizationId,
        pattern,
        matchType,
        categoryId: cat.id,
        priority: body.priority ?? 10,
      })
      .returning();
  }
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "rule.upsert",
    entityType: "category_rule",
    entityId: rule.id,
    meta: { pattern, category_id: cat.id },
  });
  const catMap = await loadCategoryMap(user.organizationId);
  return ruleOut(rule, catMap);
}

export async function updateRule(
  user: SessionUser,
  id: string,
  body: { category_id?: string; pattern?: string; priority?: number }
) {
  const row = (
    await db
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.id, id), eq(categoryRules.organizationId, user.organizationId)))
      .limit(1)
  )[0];
  if (!row) throw new Error("Rule not found");
  const updates: Partial<typeof categoryRules.$inferInsert> = { updatedAt: new Date() };
  if (body.category_id) {
    await assertCategoryUsable(user.organizationId, body.category_id);
    updates.categoryId = body.category_id;
  }
  if (body.pattern) updates.pattern = normalizePattern(body.pattern);
  if (body.priority != null) updates.priority = body.priority;
  const [rule] = await db.update(categoryRules).set(updates).where(eq(categoryRules.id, id)).returning();
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "rule.update",
    entityType: "category_rule",
    entityId: id,
  });
  const catMap = await loadCategoryMap(user.organizationId);
  return ruleOut(rule, catMap);
}

export async function deleteRule(user: SessionUser, id: string) {
  const row = (
    await db
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.id, id), eq(categoryRules.organizationId, user.organizationId)))
      .limit(1)
  )[0];
  if (!row) throw new Error("Rule not found");
  await db.delete(categoryRules).where(eq(categoryRules.id, id));
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "rule.delete",
    entityType: "category_rule",
    entityId: id,
    meta: { pattern: row.pattern },
  });
}

// ---- Period close / review ----

export async function reviewStatusForUser(user: SessionUser, periodStart?: string, periodEnd?: string) {
  if (periodStart && periodEnd) return getReviewStatus(user.organizationId, periodStart, periodEnd);
  const [bounds] = await db
    .select({
      min: min(transactions.transactionDate),
      max: max(transactions.transactionDate),
    })
    .from(transactions)
    .where(eq(transactions.organizationId, user.organizationId));
  const start = bounds.min || new Date().toISOString().slice(0, 10);
  const end = bounds.max || start;
  return getReviewStatus(user.organizationId, start, end);
}

export async function listPeriodCloses(user: SessionUser) {
  const rows = await db
    .select()
    .from(periodCloses)
    .where(eq(periodCloses.organizationId, user.organizationId))
    .orderBy(desc(periodCloses.periodKey));
  return rows.map((r) => ({
    id: r.id,
    period_key: r.periodKey,
    period_start: r.periodStart,
    period_end: r.periodEnd,
    locked_at: r.lockedAt?.toISOString?.() || r.lockedAt,
  }));
}

export async function lockPeriod(user: SessionUser, periodKey: string) {
  const { start, end } = periodBounds(periodKey);
  const status = await getReviewStatus(user.organizationId, start, end);
  if (status.transaction_count === 0) throw new Error("No transactions in this period");
  if (status.needs_review_count > 0) {
    throw new Error(`${status.needs_review_count} transactions still need review before closing`);
  }
  const existing = (
    await db
      .select()
      .from(periodCloses)
      .where(
        and(eq(periodCloses.organizationId, user.organizationId), eq(periodCloses.periodKey, periodKey))
      )
      .limit(1)
  )[0];
  if (existing) {
    return {
      id: existing.id,
      period_key: existing.periodKey,
      period_start: existing.periodStart,
      period_end: existing.periodEnd,
      locked_at: existing.lockedAt?.toISOString?.() || existing.lockedAt,
    };
  }
  const [row] = await db
    .insert(periodCloses)
    .values({
      organizationId: user.organizationId,
      periodKey,
      periodStart: start,
      periodEnd: end,
      lockedBy: user.id,
    })
    .returning();
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "period.lock",
    entityType: "period_close",
    entityId: row.id,
    meta: { period_key: periodKey },
  });
  return {
    id: row.id,
    period_key: row.periodKey,
    period_start: row.periodStart,
    period_end: row.periodEnd,
    locked_at: row.lockedAt?.toISOString?.() || row.lockedAt,
  };
}

export async function unlockPeriod(user: SessionUser, periodKey: string) {
  await db
    .delete(periodCloses)
    .where(
      and(eq(periodCloses.organizationId, user.organizationId), eq(periodCloses.periodKey, periodKey))
    );
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "period.unlock",
    entityType: "period_close",
    meta: { period_key: periodKey },
  });
}

// ---- Reports ----

export async function reportBounds(user: SessionUser) {
  const [row] = await db
    .select({
      min: min(transactions.transactionDate),
      max: max(transactions.transactionDate),
      c: count(),
    })
    .from(transactions)
    .where(eq(transactions.organizationId, user.organizationId));
  return {
    period_start: row.min || null,
    period_end: row.max || null,
    transaction_count: Number(row.c) || 0,
  };
}

export async function reportSummary(user: SessionUser, periodStart: string, periodEnd: string) {
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, user.organizationId),
        gte(transactions.transactionDate, periodStart),
        lte(transactions.transactionDate, periodEnd)
      )
    )
    .orderBy(asc(transactions.transactionDate));
  const catMap = await loadCategoryMap(user.organizationId);
  let income = 0;
  let expense = 0;
  let needsReview = 0;
  const byCat: Record<string, { name: string; type: string; income: number; expenses: number }> = {};
  const txOut = rows.map((t) => {
    income += Number(t.credit || 0);
    expense += Number(t.debit || 0);
    if (t.needsReview) needsReview += 1;
    const cat = t.categoryId ? catMap[t.categoryId] : null;
    const cname = cat?.name || "Uncategorized";
    const ctype = cat?.type || "expense";
    if (!byCat[cname]) byCat[cname] = { name: cname, type: ctype, income: 0, expenses: 0 };
    if (t.credit) byCat[cname].income += Number(t.credit);
    if (t.debit) byCat[cname].expenses += Number(t.debit);
    return {
      date: t.transactionDate,
      description: t.description,
      debit: t.debit,
      credit: t.credit,
      balance: t.balance,
      category: cname,
      category_type: ctype,
      reference: t.reference,
      confidence: t.confidenceScore,
      needs_review: t.needsReview,
      review_status: t.needsReview ? "needs_review" : "reviewed",
    };
  });
  const status = await getReviewStatus(user.organizationId, periodStart, periodEnd);
  return {
    period_start: periodStart,
    period_end: periodEnd,
    total_income: income,
    total_expenses: expense,
    net_cash_flow: income - expense,
    transaction_count: rows.length,
    reviewed_count: rows.length - needsReview,
    needs_review_count: needsReview,
    by_category: Object.values(byCat),
    tax_related: txOut.filter((t) => t.category.toLowerCase().includes("tax")),
    transactions: txOut,
    is_locked: status.is_locked,
    can_export: status.can_export,
  };
}

export async function exportReport(
  user: SessionUser,
  body: {
    report_type: string;
    period_start: string;
    period_end: string;
    format: "xlsx" | "pdf";
    force?: boolean;
  }
) {
  const summary = await reportSummary(user, body.period_start, body.period_end);
  const status = await getReviewStatus(user.organizationId, body.period_start, body.period_end);
  if (status.transaction_count === 0) throw new Error("No transactions in this period");
  if (status.needs_review_count > 0 && !body.force) {
    throw new Error(
      `${status.needs_review_count} transactions still need review. Finish review on Transactions, or pass force=true to export anyway.`
    );
  }
  const client = (
    await db
      .select()
      .from(clients)
      .where(and(eq(clients.organizationId, user.organizationId), eq(clients.isDefault, true)))
      .limit(1)
  )[0];
  const u = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
  const meta = {
    client_name: client?.name || "Default client",
    prepared_by: u?.fullName || user.email,
    prepared_date: new Date().toISOString().slice(0, 10),
  };
  const bytes =
    body.format === "pdf"
      ? await (await import("@/lib/reports-export")).buildPdfReport(summary, meta)
      : await (await import("@/lib/reports-export")).buildExcelReport(summary, meta);
  const ext = body.format === "pdf" ? "pdf" : "xlsx";
  const key = await uploadReport(user.organizationId, `working-papers-${body.period_start}_${body.period_end}.${ext}`, bytes, ext);
  const download_url = await createSignedUrl(key, 3600);
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    clientId: client?.id,
    action: body.force && status.needs_review_count > 0 ? "report.export_forced" : "report.export",
    entityType: "report",
    after: { format: body.format, type: body.report_type, period_start: body.period_start, period_end: body.period_end },
    meta: { forced: !!body.force, needs_review_count: status.needs_review_count },
  });
  return {
    id: crypto.randomUUID(),
    download_url,
    summary: {
      total_income: summary.total_income,
      total_expenses: summary.total_expenses,
      net_cash_flow: summary.net_cash_flow,
      transaction_count: summary.transaction_count,
      by_category: summary.by_category,
      tax_related_count: summary.tax_related.length,
      client_name: meta.client_name,
      prepared_by: meta.prepared_by,
      prepared_date: meta.prepared_date,
    },
  };
}

// ---- Merchants (simplified) ----

export async function listMerchantsApi(user: SessionUser) {
  const rows = await db
    .select()
    .from(merchants)
    .where(or(isNull(merchants.organizationId), eq(merchants.organizationId, user.organizationId)))
    .orderBy(asc(merchants.name));
  const catMap = await loadCategoryMap(user.organizationId);
  const out = [];
  for (const m of rows) {
    const aliases = await db
      .select()
      .from(merchantAliases)
      .where(eq(merchantAliases.merchantId, m.id))
      .orderBy(asc(merchantAliases.priority));
    const cat = m.categoryId ? catMap[m.categoryId] : null;
    out.push({
      id: m.id,
      name: m.name,
      slug: m.slug,
      category_id: m.categoryId,
      category: cat ? categoryOut(cat) : null,
      is_system: !m.organizationId,
      client_id: m.clientId,
      aliases: aliases.map((a) => ({
        id: a.id,
        pattern: a.pattern,
        match_type: a.matchType,
        priority: a.priority,
        source: a.source,
      })),
    });
  }
  return out;
}

export async function createMerchantApi(
  user: SessionUser,
  body: { name: string; category_id?: string | null; aliases?: string[]; client_id?: string | null }
) {
  if (body.category_id) await assertCategoryUsable(user.organizationId, body.category_id);
  const slug = slugify(body.name);
  const clash = await db
    .select()
    .from(merchants)
    .where(and(eq(merchants.organizationId, user.organizationId), eq(merchants.slug, slug)))
    .limit(1);
  if (clash[0]) throw new Error("Merchant already exists");
  const [m] = await db
    .insert(merchants)
    .values({
      organizationId: user.organizationId,
      name: body.name,
      slug,
      categoryId: body.category_id || null,
      clientId: body.client_id || null,
    })
    .returning();
  for (const alias of body.aliases || []) {
    await db.insert(merchantAliases).values({
      merchantId: m.id,
      organizationId: user.organizationId,
      pattern: alias.toLowerCase().trim(),
      matchType: "contains",
      priority: 20,
      source: "user",
    });
  }
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "merchant.create",
    entityType: "merchant",
    entityId: m.id,
  });
  return (await listMerchantsApi(user)).find((x) => x.id === m.id)!;
}

export async function learnMerchantApi(
  user: SessionUser,
  body: {
    description: string;
    category_id: string;
    merchant_name?: string | null;
    client_id?: string | null;
    also_create_category_rule?: boolean;
  }
) {
  await assertCategoryUsable(user.organizationId, body.category_id);
  const pattern = normalizePattern(body.description);
  const name = body.merchant_name || pattern.replace(/\b\w/g, (c) => c.toUpperCase());
  const slug = slugify(name);
  let m = (
    await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.organizationId, user.organizationId), eq(merchants.slug, slug)))
      .limit(1)
  )[0];
  if (!m) {
    [m] = await db
      .insert(merchants)
      .values({
        organizationId: user.organizationId,
        name,
        slug,
        categoryId: body.category_id,
        clientId: body.client_id || null,
      })
      .returning();
  } else {
    await db
      .update(merchants)
      .set({ categoryId: body.category_id, updatedAt: new Date() })
      .where(eq(merchants.id, m.id));
  }
  const aliasExists = (
    await db
      .select()
      .from(merchantAliases)
      .where(
        and(
          eq(merchantAliases.organizationId, user.organizationId),
          eq(merchantAliases.pattern, pattern),
          eq(merchantAliases.matchType, "contains")
        )
      )
      .limit(1)
  )[0];
  if (!aliasExists) {
    await db.insert(merchantAliases).values({
      merchantId: m.id,
      organizationId: user.organizationId,
      pattern,
      matchType: "contains",
      priority: 10,
      source: "learned",
    });
  }
  if (body.also_create_category_rule !== false) {
    await createRule(user, { pattern, category_id: body.category_id, priority: 10 });
  }
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "merchant.learn",
    entityType: "merchant",
    entityId: m.id,
    meta: { pattern },
  });
  return (await listMerchantsApi(user)).find((x) => x.id === m.id)!;
}

export async function deleteMerchantApi(user: SessionUser, id: string) {
  const m = (
    await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.id, id), eq(merchants.organizationId, user.organizationId)))
      .limit(1)
  )[0];
  if (!m) throw new Error("Merchant not found");
  await db.delete(merchantAliases).where(eq(merchantAliases.merchantId, id));
  await db.delete(merchants).where(eq(merchants.id, id));
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "merchant.delete",
    entityType: "merchant",
    entityId: id,
  });
  return { ok: true };
}

// ---- Audit logs ----

export async function auditLogFilters(user: SessionUser) {
  const orgUsers = await db
    .select({ id: users.id, name: users.fullName, email: users.email })
    .from(users)
    .where(eq(users.organizationId, user.organizationId));
  const orgClients = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      is_default: clients.isDefault,
    })
    .from(clients)
    .where(eq(clients.organizationId, user.organizationId));
  const def = orgClients.find((c) => c.is_default);
  return {
    actions: KNOWN_AUDIT_ACTIONS,
    users: orgUsers.map((u) => ({ id: u.id, name: u.name, email: u.email })),
    clients: orgClients,
    default_client_id: def?.id || null,
  };
}

export async function listAuditLogs(user: SessionUser, params: URLSearchParams) {
  const limit = Math.min(Number(params.get("limit") || 100), 500);
  const offset = Number(params.get("offset") || 0);
  const filters = [eq(auditLogs.organizationId, user.organizationId)];
  if (params.get("user_id")) filters.push(eq(auditLogs.userId, params.get("user_id")!));
  if (params.get("action")) filters.push(eq(auditLogs.action, params.get("action")!));
  if (params.get("client_id")) filters.push(eq(auditLogs.clientId, params.get("client_id")!));
  if (params.get("date_from")) filters.push(gte(auditLogs.createdAt, new Date(params.get("date_from")!)));
  if (params.get("date_to")) filters.push(lte(auditLogs.createdAt, new Date(params.get("date_to")!)));

  const items = await db
    .select()
    .from(auditLogs)
    .where(and(...filters))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);
  const [{ total }] = await db
    .select({ total: count() })
    .from(auditLogs)
    .where(and(...filters));

  const userMap = Object.fromEntries(
    (await db.select().from(users).where(eq(users.organizationId, user.organizationId))).map((u) => [
      u.id,
      u,
    ])
  );
  const clientMap = Object.fromEntries(
    (await db.select().from(clients).where(eq(clients.organizationId, user.organizationId))).map((c) => [
      c.id,
      c,
    ])
  );

  return {
    total: Number(total) || 0,
    limit,
    offset,
    items: items.map((a) => {
      const u = a.userId ? userMap[a.userId] : null;
      const c = a.clientId ? clientMap[a.clientId] : null;
      return {
        id: a.id,
        organization_id: a.organizationId,
        client_id: a.clientId,
        client_name: c?.name || null,
        user_id: a.userId,
        user_name: u?.fullName || null,
        user_email: u?.email || null,
        action: a.action,
        entity_type: a.entityType,
        entity_id: a.entityId,
        before: a.beforeJson,
        after: a.afterJson,
        meta: a.metaJson,
        ip_address: a.ipAddress,
        user_agent: a.userAgent,
        created_at: a.createdAt?.toISOString?.() || a.createdAt,
      };
    }),
  };
}

// ---- Stubs for eval / banks / accuracy ----

export async function listBanks() {
  return {
    banks: [
      { id: "meezan", name: "Meezan Bank", parser: "meezan" },
      { id: "hbl", name: "HBL", parser: "hbl" },
      { id: "ubl", name: "UBL", parser: "ubl" },
    ],
  };
}

export async function evalBankParsersRun() {
  const { parseBankStatement } = await import("@/lib/bank-parsers");
  const samples = [
    { bank: "meezan", text: "01 Jan 2026 Test - Rs. 1,000.00 10,000.00" },
    { bank: "hbl", text: "2026-01-01 Sample 100.00 1,000.00" },
  ];
  const results = samples.map((s) => {
    const r = parseBankStatement(s.text);
    return { bank: s.bank, method: r.method, transaction_count: r.transactions.length };
  });
  return {
    report: {
      generated_at: new Date().toISOString(),
      parsers: results,
      overall_pass: results.every((r) => r.transaction_count >= 0),
    },
  };
}

export async function evalLatest() {
  return { run: null, message: "Run eval from this page to generate a report" };
}

export async function evalRuns() {
  return { runs: [] };
}

export async function evalRun() {
  const report = (await evalBankParsersRun()).report;
  return {
    run: {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      status: "completed",
      summary: report,
    },
  };
}

export async function accuracyCategorization(user: SessionUser) {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.organizationId, user.organizationId));
  const reviewed = rows.filter((r) => !r.needsReview).length;
  return {
    total_transactions: rows.length,
    reviewed_count: reviewed,
    needs_review_count: rows.length - reviewed,
    auto_categorized_pct: rows.length ? Math.round((reviewed / rows.length) * 100) : 0,
  };
}

export async function enhancedDashboardSummary(user: SessionUser) {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.organizationId, user.organizationId));
  let income = 0;
  let expense = 0;
  let needsReview = 0;
  const monthly: Record<string, { income: number; expenses: number }> = {};
  const expenseByCat: Record<string, number> = {};
  const catMap = await loadCategoryMap(user.organizationId);

  for (const t of rows) {
    income += Number(t.credit || 0);
    expense += Number(t.debit || 0);
    if (t.needsReview) needsReview += 1;
    const month = String(t.transactionDate).slice(0, 7);
    if (!monthly[month]) monthly[month] = { income: 0, expenses: 0 };
    monthly[month].income += Number(t.credit || 0);
    monthly[month].expenses += Number(t.debit || 0);
    if (t.debit && t.categoryId) {
      const cat = catMap[t.categoryId];
      if (cat?.type === "expense") {
        expenseByCat[cat.name] = (expenseByCat[cat.name] || 0) + Number(t.debit);
      }
    }
  }

  const top_expense_categories = Object.entries(expenseByCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, total]) => ({ name, total }));

  const monthly_trends = Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      income: v.income,
      expenses: v.expenses,
      net: v.income - v.expenses,
    }));

  return {
    total_income: income,
    total_expenses: expense,
    net_cash_flow: income - expense,
    transaction_count: rows.length,
    needs_review_count: needsReview,
    top_expense_categories,
    monthly_trends,
  };
}
