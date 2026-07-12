export type Category = {
  id: string;
  name: string;
  slug: string;
  type: string;
  is_system?: boolean;
};

export type RuleSuggestion = {
  pattern: string;
  category_id: string;
  category_name: string;
  preview: string;
  merchant_name?: string | null;
};

export type Transaction = {
  id: string;
  document_id: string;
  transaction_date: string;
  description: string;
  debit: string | number | null;
  credit: string | number | null;
  balance: string | number | null;
  reference: string | null;
  category_id: string | null;
  category: Category | null;
  confidence_score: string | number | null;
  needs_review: boolean;
  page_number?: number | null;
  extraction_source?: string | null;
  source_meta?: Record<string, unknown> | null;
  suggested_category?: Category | null;
  rule_suggestion?: RuleSuggestion | null;
};

export type DocumentItem = {
  id: string;
  filename: string;
  status: string;
  page_count: number | null;
  error_message: string | null;
  bank_name: string | null;
  created_at: string | null;
  transaction_count?: number;
  extraction_meta?: {
    method?: string;
    ai_fallback?: boolean;
    used_ocr?: boolean;
    transaction_count?: number;
    dropped_rows?: number;
    tie_out?: "match" | "mismatch" | "unknown";
    stated_closing?: number | null;
    ledger_closing?: number | null;
    difference?: number | null;
    text_chars?: number;
  } | null;
};

export type DashboardSummary = {
  total_income: number;
  total_expenses: number;
  net_cash_flow: number;
  transaction_count: number;
  needs_review_count?: number;
  top_expense_categories: { name: string; total: number }[];
  monthly_trends: { month: string; income: number; expenses: number; net: number }[];
};

export type CategoryRule = {
  id: string;
  pattern: string;
  match_type: string;
  category_id: string;
  category: Category | null;
  priority: number;
};

export type ReviewStatus = {
  period_start: string;
  period_end: string;
  transaction_count: number;
  needs_review_count: number;
  reviewed_count: number;
  is_locked: boolean;
  can_export: boolean;
  period_key: string | null;
};

export type PeriodClose = {
  id: string;
  period_key: string;
  period_start: string;
  period_end: string;
  locked_at: string;
};

export type MeResponse = {
  user: { id: string; email: string; full_name: string; organization_id: string };
  organization: { id: string; name: string; slug: string };
};

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getApiUrl() {
  return API_URL.replace(/\/$/, "");
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, headers, ...rest } = options;
  // Prefer same-origin Next API when running on Vercel (no external FastAPI)
  const base =
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL || getApiUrl();
  const useLocal = !process.env.API_URL || process.env.ATLAS_API_MODE === "vercel";
  const url = useLocal
    ? `${(process.env.NEXT_PUBLIC_APP_URL || base).replace(/\/$/, "")}/api/proxy${path}`
    : `${getApiUrl()}/api/v1${path}`;

  const res = await fetch(url, {
    ...rest,
    headers: {
      ...(headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    let detail = "Request failed";
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Browser-side helper that goes through Next BFF cookie session */
export async function clientApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = "Request failed";
    try {
      const body = await res.json();
      detail = body.detail || body.error || detail;
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * Public API origin for browser → API uploads (bypasses Vercel ~4.5MB body limit).
 * Set NEXT_PUBLIC_API_URL to your Railway/Fly API URL in production.
 */
export function getBrowserApiUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) return null;
  return url.replace(/\/$/, "");
}

async function getClientAccessToken(): Promise<string> {
  const res = await fetch("/api/auth/access-token");
  if (!res.ok) throw new Error("Not authenticated");
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Not authenticated");
  return data.access_token;
}

/**
 * Upload a PDF. On Vercel uses direct API upload when NEXT_PUBLIC_API_URL is set
 * (avoids the serverless request body limit on /api/proxy).
 */
export async function uploadDocument(
  file: File,
  opts: { force?: boolean } = {}
): Promise<DocumentItem> {
  const form = new FormData();
  form.append("file", file);
  const qs = opts.force ? "?force=true" : "";
  const browserApi = getBrowserApiUrl();

  let res: Response;
  if (browserApi) {
    const token = await getClientAccessToken();
    res = await fetch(`${browserApi}/api/v1/documents/upload${qs}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } else {
    res = await fetch(`/api/proxy/documents/upload${qs}`, {
      method: "POST",
      body: form,
    });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      typeof data.detail === "string"
        ? data.detail
        : data.error || "Upload failed"
    ) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data as DocumentItem;
}
