"use client";

import { useCallback, useEffect, useState } from "react";
import { Filter, RefreshCw, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clientApi } from "@/lib/api";

type AuditItem = {
  id: string;
  organization_id: string;
  client_id: string | null;
  client_name: string | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string | null;
};

type FilterOptions = {
  actions: string[];
  users: { id: string; name: string; email: string }[];
  clients: { id: string; name: string; slug: string; is_default: boolean }[];
  default_client_id: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Login",
  "auth.login_failed": "Failed login",
  "auth.logout": "Logout",
  "auth.signup": "Signup",
  "document.upload": "Document upload",
  "document.extraction_completed": "Extraction completed",
  "document.reprocess": "Document reprocess",
  "document.delete": "Document delete",
  "transaction.category_changed": "Category changed",
  "transaction.review_cleared": "Review cleared",
  "transaction.bulk_action": "Bulk action",
  "report.export": "Report export",
  "report.export_forced": "Forced export",
  "period.lock": "Month locked",
  "period.unlock": "Month unlocked",
};

function labelAction(action: string): string {
  return ACTION_LABELS[action] || action;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function JsonBlock({ value }: { value: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <pre className="max-h-40 overflow-auto rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function AuditPage() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<FilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [clientId, setClientId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadFilters = useCallback(async () => {
    const data = await clientApi<FilterOptions>("/audit-logs/filters");
    setFilters(data);
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (userId) params.set("user_id", userId);
      if (action) params.set("action", action);
      if (clientId) params.set("client_id", clientId);
      if (dateFrom) params.set("date_from", new Date(dateFrom).toISOString());
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        params.set("date_to", end.toISOString());
      }
      params.set("limit", "100");
      const qs = params.toString();
      const data = await clientApi<{ total: number; items: AuditItem[] }>(
        `/audit-logs${qs ? `?${qs}` : ""}`
      );
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [userId, action, clientId, dateFrom, dateTo]);

  useEffect(() => {
    loadFilters().catch(() => undefined);
  }, [loadFilters]);

  useEffect(() => {
    loadLogs().catch(() => undefined);
  }, [loadLogs]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Compliance</p>
          <h1 className="font-display text-3xl tracking-tight">Audit log</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Append-only trail of authentication, documents, transactions, exports, and month close.
            Records are never edited or deleted.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadLogs()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
          <CardDescription>
            Narrow by user, date range, action, or client. Showing {items.length} of {total}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">User</span>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              >
                <option value="">All users</option>
                {(filters?.users || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Action</span>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={action}
                onChange={(e) => setAction(e.target.value)}
              >
                <option value="">All actions</option>
                {(filters?.actions || []).map((a) => (
                  <option key={a} value={a}>
                    {labelAction(a)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Client</span>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">All clients</option>
                {(filters?.clients || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.is_default ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">From</span>
              <input
                type="date"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">To</span>
              <input
                type="date"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-3">
        {loading && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading audit trail…</p>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
              <ScrollText className="h-5 w-5" />
              No audit events match these filters.
            </CardContent>
          </Card>
        ) : (
          items.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{labelAction(row.action)}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.action} · {row.entity_type}
                      {row.entity_id ? ` · ${row.entity_id.slice(0, 8)}…` : ""}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatWhen(row.created_at)}</p>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">User</p>
                    <p>
                      {row.user_name || "System"}
                      {row.user_email ? (
                        <span className="text-muted-foreground"> · {row.user_email}</span>
                      ) : null}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Client</p>
                    <p>{row.client_name || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      IP / agent
                    </p>
                    <p className="truncate text-xs">
                      {row.ip_address || "—"}
                      {row.user_agent ? (
                        <span className="block truncate text-muted-foreground" title={row.user_agent}>
                          {row.user_agent}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                      Before
                    </p>
                    <JsonBlock value={row.before} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                      After
                    </p>
                    <JsonBlock value={row.after} />
                  </div>
                </div>
                {row.meta && Object.keys(row.meta).length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                      Meta
                    </p>
                    <JsonBlock value={row.meta} />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
