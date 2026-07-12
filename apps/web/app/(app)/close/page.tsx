"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clientApi, type PeriodClose, type ReviewStatus } from "@/lib/api";
import { ExportWorkingPapersButtons } from "@/components/export-working-papers";

function currentPeriodKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function MonthClosePage() {
  const [periodKey, setPeriodKey] = useState(currentPeriodKey);
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [closes, setCloses] = useState<PeriodClose[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const load = useCallback(async (key: string) => {
    setError("");
    try {
      const [s, c] = await Promise.all([
        clientApi<ReviewStatus>(`/close/${key}/status`),
        clientApi<PeriodClose[]>("/close"),
      ]);
      setStatus(s);
      setCloses(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    (async () => {
      let key = currentPeriodKey();
      try {
        const bounds = await clientApi<{ period_end: string | null }>("/reports/bounds");
        if (bounds.period_end) key = bounds.period_end.slice(0, 7);
      } catch {
        /* keep current month */
      }
      setPeriodKey(key);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    load(periodKey);
  }, [periodKey, ready, load]);

  const readyToClose = useMemo(
    () =>
      !!status &&
      status.transaction_count > 0 &&
      status.needs_review_count === 0 &&
      !status.is_locked,
    [status]
  );

  async function closeMonth() {
    setBusy(true);
    setError("");
    try {
      await clientApi("/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_key: periodKey }),
      });
      await load(periodKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Close failed");
    } finally {
      setBusy(false);
    }
  }

  async function reopen(key: string) {
    if (!window.confirm(`Reopen ${key}? Edits will be allowed again.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/proxy/close/${key}`, { method: "DELETE" });
      await load(periodKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reopen failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Month close</h1>
        <p className="mt-1 text-muted-foreground">
          Review uncertain rows, lock the month, then export the pack.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="period">Period (YYYY-MM)</Label>
          <Input
            id="period"
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
            placeholder="2026-06"
            className="w-40"
          />
        </div>
        <Button variant="outline" onClick={() => load()} disabled={busy}>
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {status && (
        <div className="grid gap-4 md:grid-cols-4">
          <Metric label="Transactions" value={String(status.transaction_count)} />
          <Metric label="Needs review" value={String(status.needs_review_count)} warn={status.needs_review_count > 0} />
          <Metric label="Reviewed" value={String(status.reviewed_count)} />
          <Metric label="Status" value={status.is_locked ? "Locked" : "Open"} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Close checklist</CardTitle>
          <CardDescription>
            {status?.period_start} → {status?.period_end}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Clear the review queue{" "}
              {status && status.needs_review_count > 0 ? (
                <>
                  <Link
                    href="/transactions?needs_review=true"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    ({status.needs_review_count} left)
                  </Link>
                  {" · "}
                  <Link
                    href="/documents"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    PDF side-by-side
                  </Link>
                </>
              ) : (
                <span className="text-foreground">✓</span>
              )}
            </li>
            <li>Lock the month so categories can’t drift</li>
            <li>Export Excel working papers (PKR) for the accountant</li>
          </ol>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={closeMonth} disabled={!readyToClose || busy}>
              {status?.is_locked ? "Already locked" : "Lock month"}
            </Button>
            {status && (
              <ExportWorkingPapersButtons
                periodStart={status.period_start}
                periodEnd={status.period_end}
                showReportsLink
              />
            )}
          </div>
          {status && status.needs_review_count > 0 && (
            <p className="text-sm text-amber-700">
              Clear review first for a clean pack — or confirm when prompted to export with
              remaining Needs review rows flagged.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Closed periods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {closes.length === 0 && (
            <p className="text-sm text-muted-foreground">No months locked yet.</p>
          )}
          {closes.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between border-b border-border/60 py-2 last:border-0"
            >
              <div>
                <p className="text-sm font-medium">{c.period_key}</p>
                <p className="text-xs text-muted-foreground">
                  Locked {new Date(c.locked_at).toLocaleString()}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => reopen(c.period_key)} disabled={busy}>
                Reopen
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="border-b border-border/70 pb-3">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-2xl ${warn ? "text-amber-700" : ""}`}>{value}</p>
    </div>
  );
}
