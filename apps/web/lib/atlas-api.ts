import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import {
  categories,
  clients,
  documents,
  organizations,
  transactions,
  users,
} from "@/lib/schema";
import {
  createAccessToken,
  createRefreshToken,
  hashPassword,
  verifyPassword,
} from "@/lib/auth-server";
import { downloadPdf, uploadPdf } from "@/lib/storage";
import type { PdfExtraction } from "@/lib/pdf-extract";
import type { SessionUser } from "@/lib/session";

const SYSTEM_CATEGORIES = [
  { name: "Salary", slug: "salary", type: "income" },
  { name: "Other Income", slug: "other-income", type: "income" },
  { name: "Rent", slug: "rent", type: "expense" },
  { name: "Utilities", slug: "utilities", type: "expense" },
  { name: "Groceries", slug: "groceries", type: "expense" },
  { name: "Transport", slug: "transport", type: "expense" },
  { name: "Dining", slug: "dining", type: "expense" },
  { name: "Transfer", slug: "transfer", type: "expense" },
  { name: "Fees", slug: "fees", type: "expense" },
  { name: "Other", slug: "other", type: "expense" },
];

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org";
}

async function ensureSystemCategories() {
  for (const cat of SYSTEM_CATEGORIES) {
    const existing = await db
      .select()
      .from(categories)
      .where(and(eq(categories.slug, cat.slug), isNull(categories.organizationId)))
      .limit(1);
    if (!existing[0]) {
      await db.insert(categories).values({
        name: cat.name,
        slug: cat.slug,
        type: cat.type,
        isSystem: true,
        organizationId: null,
      });
    }
  }
}

async function ensureDefaultClient(orgId: string) {
  const existing = await db
    .select()
    .from(clients)
    .where(and(eq(clients.organizationId, orgId), eq(clients.isDefault, true)))
    .limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db
    .insert(clients)
    .values({
      organizationId: orgId,
      name: "Default client",
      slug: "default",
      isDefault: true,
      status: "active",
    })
    .returning();
  return row;
}

async function resolveClient(orgId: string, clientId?: string | null) {
  if (clientId) {
    const row = (
      await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId)))
        .limit(1)
    )[0];
    if (row) return row;
  }
  return ensureDefaultClient(orgId);
}

async function persistExtractedDocument(
  user: SessionUser,
  docId: string,
  clientId: string,
  bytes: Buffer
) {
  const { extractTransactionsFromPdf } = await import("@/lib/pdf-extract");
  const extracted: PdfExtraction = await extractTransactionsFromPdf(bytes);
  if (!extracted.transactions.length) {
    await db
      .update(documents)
      .set({
        status: "failed",
        errorMessage: "No transactions could be extracted from this PDF",
        pageCount: extracted.page_count || null,
        extractionMetaJson: {
          method: extracted.method,
          text_chars: extracted.text_chars,
        },
        updatedAt: new Date(),
      })
      .where(eq(documents.id, docId));
    return extracted;
  }

  const other = (
    await db
      .select()
      .from(categories)
      .where(and(eq(categories.slug, "other"), isNull(categories.organizationId)))
      .limit(1)
  )[0];

  for (const tx of extracted.transactions) {
    await db.insert(transactions).values({
      organizationId: user.organizationId,
      clientId,
      documentId: docId,
      categoryId: other?.id,
      transactionDate: tx.transaction_date,
      description: tx.description,
      debit: tx.debit,
      credit: tx.credit,
      balance: tx.balance,
      confidenceScore: String(tx.confidence),
      needsReview: tx.confidence < 0.7 || !other,
      extractionSource: extracted.method,
      pageNumber: tx.page_number,
      sourceMetaJson: tx.source_meta,
    });
  }

  await db
    .update(documents)
    .set({
      status: "ready",
      bankName: extracted.bank_name,
      pageCount: extracted.page_count || null,
      extractionMetaJson: {
        method: extracted.method,
        text_chars: extracted.text_chars,
        transaction_count: extracted.transactions.length,
        highlights_attached: extracted.transactions.filter((t) => t.source_meta?.bbox_norm).length,
        layout_lines: extracted.transactions.length,
      },
      updatedAt: new Date(),
    })
    .where(eq(documents.id, docId));

  return extracted;
}

export async function signup(body: {
  email: string;
  password: string;
  full_name: string;
  organization_name: string;
}) {
  await ensureSystemCategories();
  const email = body.email.toLowerCase().trim();
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) throw new Error("Email already registered");

  let slug = slugify(body.organization_name);
  let n = 1;
  while (true) {
    const clash = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (!clash[0]) break;
    slug = `${slugify(body.organization_name)}-${n++}`;
  }

  const [org] = await db
    .insert(organizations)
    .values({ name: body.organization_name, slug })
    .returning();
  await ensureDefaultClient(org.id);

  const [user] = await db
    .insert(users)
    .values({
      email,
      fullName: body.full_name,
      passwordHash: await hashPassword(body.password),
      organizationId: org.id,
    })
    .returning();

  return {
    access_token: await createAccessToken(user.id),
    refresh_token: await createRefreshToken(user.id),
  };
}

export async function login(body: { email: string; password: string }) {
  const email = body.email.toLowerCase().trim();
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw new Error("Invalid email or password");
  }
  return {
    access_token: await createAccessToken(user.id),
    refresh_token: await createRefreshToken(user.id),
  };
}

export async function me(user: SessionUser) {
  const org = (
    await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1)
  )[0];
  return {
    user: {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      organization_id: user.organizationId,
    },
    organization: org
      ? { id: org.id, name: org.name, slug: org.slug }
      : { id: user.organizationId, name: "Workspace", slug: "workspace" },
  };
}

export async function listDocuments(user: SessionUser, clientId?: string | null) {
  const filters = [eq(documents.organizationId, user.organizationId)];
  if (clientId) filters.push(eq(documents.clientId, clientId));

  const docs = await db
    .select()
    .from(documents)
    .where(and(...filters))
    .orderBy(desc(documents.createdAt));

  const counts = await db
    .select({
      documentId: transactions.documentId,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(eq(transactions.organizationId, user.organizationId))
    .groupBy(transactions.documentId);
  const countMap = Object.fromEntries(counts.map((c) => [c.documentId, c.count]));

  return docs.map((d) => ({
    id: d.id,
    filename: d.filename,
    status: d.status,
    page_count: d.pageCount,
    error_message: d.errorMessage,
    bank_name: d.bankName,
    created_at: d.createdAt?.toISOString?.() || d.createdAt,
    transaction_count: countMap[d.id] || 0,
    extraction_meta: d.extractionMetaJson,
  }));
}

export async function uploadDocument(
  user: SessionUser,
  file: File,
  force = false,
  clientId?: string | null
) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only PDF files are allowed");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new Error("File exceeds 20MB limit");
  if (!bytes.subarray(0, 4).equals(Buffer.from("%PDF"))) throw new Error("Invalid PDF file");

  const contentHash = createHash("sha256").update(bytes).digest("hex");
  if (!force) {
    const dup = await db
      .select()
      .from(documents)
      .where(
        and(eq(documents.organizationId, user.organizationId), eq(documents.contentHash, contentHash))
      )
      .limit(1);
    if (dup[0]) {
      const err = new Error(
        `Duplicate statement detected (same file as “${dup[0].filename}”). Re-upload with force=true if you really want a copy.`
      ) as Error & { status?: number };
      err.status = 409;
      throw err;
    }
  }

  const client = await resolveClient(user.organizationId, clientId);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const key = await uploadPdf(user.organizationId, safeName, bytes);

  const [doc] = await db
    .insert(documents)
    .values({
      organizationId: user.organizationId,
      clientId: client.id,
      filename: safeName,
      s3Key: key,
      status: "processing",
      contentHash,
    })
    .returning();

  try {
    await persistExtractedDocument(user, doc.id, client.id, bytes);
  } catch (e) {
    await db
      .update(documents)
      .set({
        status: "failed",
        errorMessage: e instanceof Error ? e.message.slice(0, 2000) : "Extraction failed",
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));
  }

  const fresh = (
    await db.select().from(documents).where(eq(documents.id, doc.id)).limit(1)
  )[0];
  const count = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.documentId, doc.id));

  return {
    id: fresh.id,
    filename: fresh.filename,
    status: fresh.status,
    page_count: fresh.pageCount,
    error_message: fresh.errorMessage,
    bank_name: fresh.bankName,
    created_at: fresh.createdAt?.toISOString?.() || fresh.createdAt,
    transaction_count: count[0]?.count || 0,
    extraction_meta: fresh.extractionMetaJson,
  };
}

export async function listTransactions(user: SessionUser, params: URLSearchParams) {
  const limit = Math.min(Number(params.get("limit") || 100), 500);
  const needsReview = params.get("needs_review");
  const documentId = params.get("document_id");
  const clientId = params.get("client_id");

  const filters = [eq(transactions.organizationId, user.organizationId)];
  if (needsReview === "true") filters.push(eq(transactions.needsReview, true));
  if (needsReview === "false") filters.push(eq(transactions.needsReview, false));
  if (documentId) filters.push(eq(transactions.documentId, documentId));
  else if (clientId) filters.push(eq(transactions.clientId, clientId));

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...filters))
    .orderBy(desc(transactions.transactionDate))
    .limit(limit);

  const cats = await db.select().from(categories);
  const catMap = Object.fromEntries(cats.map((c) => [c.id, c]));

  return rows.map((t) => {
    const cat = t.categoryId ? catMap[t.categoryId] : null;
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
      category: cat
        ? { id: cat.id, name: cat.name, slug: cat.slug, type: cat.type, is_system: cat.isSystem }
        : null,
      confidence_score: t.confidenceScore,
      needs_review: t.needsReview,
      page_number: t.pageNumber,
      extraction_source: t.extractionSource,
      source_meta: t.sourceMetaJson,
    };
  });
}

export async function listCategories(user: SessionUser) {
  const rows = await db
    .select()
    .from(categories)
    .where(or(isNull(categories.organizationId), eq(categories.organizationId, user.organizationId)));
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    type: c.type,
    is_system: c.isSystem,
  }));
}

export async function dashboardSummary(user: SessionUser) {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.organizationId, user.organizationId));

  let income = 0;
  let expense = 0;
  let needsReview = 0;
  for (const t of rows) {
    income += Number(t.credit || 0);
    expense += Number(t.debit || 0);
    if (t.needsReview) needsReview += 1;
  }
  return {
    total_income: income,
    total_expenses: expense,
    net_cash_flow: income - expense,
    transaction_count: rows.length,
    needs_review_count: needsReview,
    top_expense_categories: [],
    monthly_trends: [],
  };
}

export async function deleteDocument(user: SessionUser, id: string) {
  const doc = (
    await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.organizationId, user.organizationId)))
      .limit(1)
  )[0];
  if (!doc) throw new Error("Document not found");
  await db.delete(transactions).where(eq(transactions.documentId, id));
  await db.delete(documents).where(eq(documents.id, id));
}

export async function reprocessDocument(user: SessionUser, id: string) {
  const doc = (
    await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.organizationId, user.organizationId)))
      .limit(1)
  )[0];
  if (!doc) throw new Error("Document not found");

  await db.delete(transactions).where(eq(transactions.documentId, id));
  await db
    .update(documents)
    .set({ status: "processing", errorMessage: null, updatedAt: new Date() })
    .where(eq(documents.id, id));

  try {
    const bytes = await downloadPdf(doc.s3Key);
    await persistExtractedDocument(user, id, doc.clientId!, bytes);
  } catch (e) {
    await db
      .update(documents)
      .set({
        status: "failed",
        errorMessage: e instanceof Error ? e.message.slice(0, 2000) : "Extraction failed",
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id));
  }

  const items = await listDocuments(user);
  return items.find((d) => d.id === id);
}