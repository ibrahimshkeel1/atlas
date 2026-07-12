"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { clientApi, type DashboardSummary } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { ExportWorkingPapersButtons } from "@/components/export-working-papers";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    clientApi<DashboardSummary>("/dashboard/summary")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const reviewCount = data?.needs_review_count ?? 0;
  const kpis = [
    { label: "Total income", value: data ? formatMoney(data.total_income) : "—" },
    { label: "Total expenses", value: data ? formatMoney(data.total_expenses) : "—" },
    { label: "Net cash flow", value: data ? formatMoney(data.net_cash_flow) : "—" },
    { label: "Transactions", value: data ? String(data.transaction_count) : "—" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            Cash position and spending patterns from your bank statements.
          </p>
        </div>
        <ExportWorkingPapersButtons size="sm" />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {reviewCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>
            <span className="font-medium">{reviewCount}</span> transactions need review before
            month close / trusted export.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/transactions?needs_review=true">Review queue</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/documents">Review with PDF</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/close">Month close</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/reports">Export working papers</Link>
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="border-b border-border/70 pb-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {kpi.label}
            </p>
            <p className="mt-2 font-display text-3xl tracking-tight">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Monthly trends</CardTitle>
            <CardDescription>Income vs expenses over time</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.monthly_trends || []}>
                <defs>
                  <linearGradient id="income" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(173 58% 28%)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="hsl(173 58% 28%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 90%)" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="income"
                  stroke="hsl(173 58% 28%)"
                  fill="url(#income)"
                />
                <Area
                  type="monotone"
                  dataKey="expenses"
                  stroke="hsl(215 25% 40%)"
                  fill="transparent"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Top expenses</CardTitle>
            <CardDescription>Highest spend categories</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(data?.top_expense_categories || []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                Upload a bank statement to see category breakdowns.
              </p>
            )}
            {(data?.top_expense_categories || []).map((c) => (
              <div key={c.name} className="flex items-center justify-between gap-4">
                <span className="text-sm">{c.name}</span>
                <span className="text-sm font-medium tabular-nums">{formatMoney(c.total)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
