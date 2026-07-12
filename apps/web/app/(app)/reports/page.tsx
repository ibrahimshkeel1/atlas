"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clientApi } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { ExportWorkingPapersButtons } from "@/components/export-working-papers";

type Summary = {
  total_income: number;
  total_expenses: number;
  net_cash_flow: number;
  transaction_count: number;
  needs_review_count?: number;
  can_export?: boolean;
  is_locked?: boolean;
  by_category: { name: string; type: string; income: number; expenses: number }[];
  tax_related: unknown[];
};

const REPORTS = [
  { id: "monthly_income", title: "Monthly income report", desc: "Credits and income categories" },
  { id: "expense_breakdown", title: "Expense breakdown", desc: "Spend by category" },
  { id: "cash_flow", title: "Cash flow report", desc: "Income, expenses, and net" },
  { id: "tax_summary", title: "Tax preparation summary", desc: "Tax-tagged transactions" },
];

function localISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function ReportsPage() {
  const today = new Date();
  const fallbackStart = localISODate(new Date(today.getFullYear(), today.getMonth(), 1));
  const fallbackEnd = localISODate(today);

  const [periodStart, setPeriodStart] = useState(fallbackStart);
  const [periodEnd, setPeriodEnd] = useState(fallbackEnd);
  const [reportType, setReportType] = useState("cash_flow");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  async function loadSummary(start = periodStart, end = periodEnd) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        period_start: start,
        period_end: end,
      });
      const data = await clientApi<Summary>(`/reports/summary?${params}`);
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bounds = await clientApi<{
          period_start: string | null;
          period_end: string | null;
          transaction_count: number;
        }>("/reports/bounds");
        if (cancelled) return;
        const start = bounds.period_start || fallbackStart;
        const end = bounds.period_end || fallbackEnd;
        setPeriodStart(start);
        setPeriodEnd(end);
        setReady(true);
        await loadSummary(start, end);
      } catch {
        if (!cancelled) {
          setReady(true);
          await loadSummary(fallbackStart, fallbackEnd);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // intentionally run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Reports</h1>
        <p className="mt-1 text-muted-foreground">
          Export accountant working papers (Excel) with client header, review status, and category
          totals — PKR throughout.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-2">
          <Label>From</Label>
          <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>To</Label>
          <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Report type</Label>
          <Select value={reportType} onValueChange={setReportType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORTS.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Button onClick={() => loadSummary()} disabled={loading || !ready} className="flex-1">
            {loading ? "Loading…" : "Preview"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <ExportWorkingPapersButtons
          periodStart={periodStart || null}
          periodEnd={periodEnd || null}
          reportType={reportType}
          showReportsLink={false}
          excelPrimary
        />
        {(summary?.needs_review_count ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-3 self-center text-sm">
            <a
              href="/transactions?needs_review=true"
              className="text-primary underline-offset-4 hover:underline"
            >
              Review {summary?.needs_review_count} first
            </a>
            <a
              href="/documents"
              className="text-primary underline-offset-4 hover:underline"
            >
              PDF side-by-side
            </a>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {REPORTS.map((r) => (
          <Card
            key={r.id}
            className={reportType === r.id ? "ring-1 ring-primary" : undefined}
            onClick={() => setReportType(r.id)}
          >
            <CardHeader>
              <CardTitle className="text-base">{r.title}</CardTitle>
              <CardDescription>{r.desc}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>Summary preview</CardTitle>
            <CardDescription>
              {periodStart} → {periodEnd}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Metric label="Income" value={formatMoney(summary.total_income)} />
              <Metric label="Expenses" value={formatMoney(summary.total_expenses)} />
              <Metric label="Net" value={formatMoney(summary.net_cash_flow)} />
              <Metric label="Transactions" value={String(summary.transaction_count)} />
            </div>
            {(summary.needs_review_count ?? 0) > 0 && (
              <p className="text-sm text-amber-700">
                {summary.needs_review_count} transactions still need review — export is blocked
                until cleared (or use Force).
              </p>
            )}
            <div className="space-y-2">
              {summary.by_category.map((c) => (
                <div key={c.name} className="flex justify-between text-sm">
                  <span>
                    {c.name}{" "}
                    <span className="text-muted-foreground">({c.type})</span>
                  </span>
                  <span className="tabular-nums">
                    {c.type === "income"
                      ? formatMoney(c.income)
                      : formatMoney(c.expenses)}
                  </span>
                </div>
              ))}
            </div>
            {reportType === "tax_summary" && (
              <p className="text-sm text-muted-foreground">
                Tax-related transactions: {summary.tax_related?.length ?? 0}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl">{value}</p>
    </div>
  );
}
