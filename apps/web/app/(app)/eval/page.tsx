"use client";

import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clientApi } from "@/lib/api";

type BankSummary = {
  bank: string;
  bank_label: string;
  statements: number;
  transaction_recall: number | null;
  date_accuracy: number | null;
  debit_credit_accuracy: number | null;
  amount_accuracy: number | null;
  balance_matches: number;
  balance_evaluated: number;
  balance_unknown: number;
  public_count: number;
  private_count: number;
  statements_detail?: {
    statement_id: string;
    row_recall: number;
    amount_accuracy: number;
    date_accuracy: number;
    debit_credit_accuracy: number;
    balance_tie_out: string;
    privacy: string;
    text_source: string;
    bank_ok: boolean;
    expected_count: number;
    matched: number;
    missing_rows: number;
  }[];
};

type BankParserReport = {
  statement_count: number;
  has_measurements: boolean;
  fixture_root: string;
  include_private: boolean;
  banks: BankSummary[];
};

type BankCatalog = {
  country: string;
  currency: string;
  total: number;
  by_parser_status: Record<string, number>;
  by_category: Record<string, number>;
  source_note: string;
  banks: {
    slug: string;
    name: string;
    legal_name: string;
    category: string;
    parser_status: string;
  }[];
};

type EvalRun = {
  id: string;
  status: string;
  source: string;
  created_at: string | null;
  error: string | null;
  has_measurements: boolean;
  extraction: {
    statements_tested: number;
    transaction_recall: number | null;
    missing_rows: number;
    wrong_amounts: number;
    wrong_dates: number;
  };
  categorization: {
    fixture_count: number;
    category_accuracy: number | null;
    other_percentage: number | null;
    review_percentage: number | null;
  };
  reconciliation: {
    balance_matches: number;
    balance_mismatches: number;
    balance_unknown: number;
  };
  processing: {
    ocr_usage_count: number;
    ai_fallback_count: number;
    failure_count: number;
    parser_counts: Record<string, number>;
  };
  fixtures: {
    fixture_name: string;
    expected_bank: string | null;
    predicted_bank: string | null;
    bank_ok: boolean;
    expected_count: number;
    predicted_count: number;
    matched: number;
    missing_rows: number;
    wrong_amounts: number;
    wrong_dates: number;
    recall: number | null;
    f1: number | null;
    balance_tie_out: string;
    used_ocr: boolean;
    ai_fallback: boolean;
    parser_used: string | null;
    failed: boolean;
    error: string | null;
  }[];
};

function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${Math.round(v * 100)}%`;
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display text-2xl tracking-tight">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function EvalDashboardPage() {
  const [catalog, setCatalog] = useState<BankCatalog | null>(null);
  const [bankReport, setBankReport] = useState<BankParserReport | null>(null);
  const [run, setRun] = useState<EvalRun | null>(null);
  const [history, setHistory] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningBanks, setRunningBanks] = useState(false);
  const [runningFull, setRunningFull] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [catalogRes, banks, latest, runs] = await Promise.all([
        clientApi<BankCatalog>("/banks"),
        clientApi<{ report: BankParserReport }>("/eval/bank-parsers"),
        clientApi<{ run: EvalRun | null; message?: string }>("/eval/latest"),
        clientApi<{ runs: EvalRun[] }>("/eval/runs?limit=10"),
      ]);
      setCatalog(catalogRes);
      setBankReport(banks.report);
      setRun(latest.run);
      setHistory(runs.runs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load evaluation data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refreshBanks() {
    setRunningBanks(true);
    setError("");
    try {
      const res = await clientApi<{ report: BankParserReport }>("/eval/bank-parsers/run", {
        method: "POST",
      });
      setBankReport(res.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bank parser evaluation failed");
    } finally {
      setRunningBanks(false);
    }
  }

  async function triggerFullRun() {
    setRunningFull(true);
    setError("");
    try {
      const [banks, full] = await Promise.all([
        clientApi<{ report: BankParserReport }>("/eval/bank-parsers/run", { method: "POST" }),
        clientApi<{ run: EvalRun }>("/eval/run", { method: "POST" }),
      ]);
      setBankReport(banks.report);
      setRun(full.run);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation run failed");
    } finally {
      setRunningFull(false);
    }
  }

  const busy = runningBanks || runningFull || loading;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-border/80 bg-muted/40 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <FlaskConical className="h-3.5 w-3.5" />
            Internal · not customer-facing
          </div>
          <h1 className="font-display text-3xl tracking-tight">Extraction evaluation</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Pakistan bank catalog + measured parser scores. Dedicated fixtures today: Meezan, HBL,
            UBL. Private customer PDFs stay off this UI — use the CLI with{" "}
            <code className="text-xs">--include-private</code> locally.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={refreshBanks} disabled={busy}>
            <RefreshCw className={`h-4 w-4 ${runningBanks ? "animate-spin" : ""}`} />
            {runningBanks ? "Scoring…" : "Refresh banks"}
          </Button>
          <Button onClick={triggerFullRun} disabled={busy}>
            <Play className="h-4 w-4" />
            {runningFull ? "Running…" : "Run full evaluation"}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && (
        <p className="text-sm text-muted-foreground">Loading measured evaluation results…</p>
      )}

      {catalog && (
        <section className="space-y-3">
          <div>
            <h2 className="font-display text-xl tracking-tight">Pakistan banks</h2>
            <p className="text-sm text-muted-foreground">
              {catalog.total} institutions · {catalog.by_parser_status?.supported || 0} with
              dedicated parsers · {catalog.by_parser_status?.planned || 0} detection-ready
              (fixtures pending)
            </p>
          </div>
          <Card>
            <CardContent className="pt-4">
              <div className="mb-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
                {Object.entries(catalog.by_category).map(([cat, n]) => (
                  <span key={cat} className="rounded-md border border-border/70 px-2 py-1">
                    {cat}: {n}
                  </span>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {catalog.banks.map((b) => (
                  <div
                    key={b.slug}
                    className="flex items-start justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{b.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{b.legal_name}</p>
                      <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">
                        {b.category}
                      </p>
                    </div>
                    <span
                      className={
                        b.parser_status === "supported"
                          ? "shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800"
                          : "shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                      }
                    >
                      {b.parser_status === "supported" ? "parser" : "detect"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[11px] text-muted-foreground">{catalog.source_note}</p>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Bank parser framework — measured fixtures */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-xl tracking-tight">Measured parser scores</h2>
          <p className="text-sm text-muted-foreground">
            Public fixtures only
            {bankReport
              ? ` · ${bankReport.statement_count} statement${bankReport.statement_count === 1 ? "" : "s"}`
              : ""}
          </p>
        </div>

        {!loading && bankReport && !bankReport.has_measurements && (
          <Card>
            <CardHeader>
              <CardTitle>No bank fixtures measured</CardTitle>
              <CardDescription>
                Add labeled statements under{" "}
                <code className="text-xs">sample-data/bank-eval/public/</code> then refresh.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {bankReport?.has_measurements && (
          <div className="grid gap-4 lg:grid-cols-3">
            {bankReport.banks.map((b) => (
              <Card key={b.bank}>
                <CardHeader className="pb-3">
                  <CardTitle className="font-display text-2xl tracking-tight">
                    {b.bank_label}
                  </CardTitle>
                  <CardDescription>
                    {b.statements} statement{b.statements === 1 ? "" : "s"}
                    {b.public_count ? ` · ${b.public_count} public` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <dl className="space-y-3 text-sm">
                    <BankRow label="Transaction recall" value={pct(b.transaction_recall)} />
                    <BankRow label="Date accuracy" value={pct(b.date_accuracy)} />
                    <BankRow label="Debit/credit accuracy" value={pct(b.debit_credit_accuracy)} />
                    <BankRow label="Amount accuracy" value={pct(b.amount_accuracy)} />
                    <BankRow
                      label="Balance matches"
                      value={`${b.balance_matches}/${b.balance_evaluated}`}
                    />
                  </dl>
                  {b.statements_detail && b.statements_detail.length > 0 && (
                    <div className="border-t border-border/60 pt-3">
                      <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                        Statements
                      </p>
                      <ul className="space-y-2">
                        {b.statements_detail.map((s) => (
                          <li
                            key={s.statement_id}
                            className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                          >
                            <span className="font-medium">{s.statement_id}</span>
                            <span className="text-muted-foreground">
                              recall {pct(s.row_recall)} · amt {pct(s.amount_accuracy)} · bal{" "}
                              {s.balance_tie_out}
                              {!s.bank_ok ? " · bank miss" : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Broader persisted eval run */}
      {run && (
        <>
          <p className="text-xs text-muted-foreground">
            Full suite snapshot{" "}
            {run.created_at ? new Date(run.created_at).toLocaleString() : "—"} · {run.source} ·{" "}
            {run.status}
          </p>

          <section className="space-y-3">
            <h2 className="font-display text-xl tracking-tight">Extraction (suite)</h2>
            <Card>
              <CardContent className="grid gap-6 pt-6 sm:grid-cols-2 lg:grid-cols-5">
                <Metric
                  label="Statements tested"
                  value={String(run.extraction.statements_tested)}
                />
                <Metric
                  label="Transaction recall"
                  value={pct(run.extraction.transaction_recall)}
                />
                <Metric label="Missing rows" value={String(run.extraction.missing_rows)} />
                <Metric label="Wrong amounts" value={String(run.extraction.wrong_amounts)} />
                <Metric label="Wrong dates" value={String(run.extraction.wrong_dates)} />
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl tracking-tight">Categorization</h2>
            <Card>
              <CardContent className="grid gap-6 pt-6 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Category accuracy"
                  value={pct(run.categorization.category_accuracy)}
                  hint={
                    run.categorization.fixture_count
                      ? `${run.categorization.fixture_count} labeled fixtures`
                      : "No categorization fixtures"
                  }
                />
                <Metric label="Other percentage" value={pct(run.categorization.other_percentage)} />
                <Metric
                  label="Review percentage"
                  value={pct(run.categorization.review_percentage)}
                  hint="Share that would need human review"
                />
                <Metric label="Fixtures" value={String(run.categorization.fixture_count)} />
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl tracking-tight">Reconciliation</h2>
            <Card>
              <CardContent className="grid gap-6 pt-6 sm:grid-cols-3">
                <Metric
                  label="Balance matches"
                  value={String(run.reconciliation.balance_matches)}
                />
                <Metric
                  label="Balance mismatches"
                  value={String(run.reconciliation.balance_mismatches)}
                />
                <Metric
                  label="Balance unknown"
                  value={String(run.reconciliation.balance_unknown)}
                />
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl tracking-tight">Processing</h2>
            <Card>
              <CardContent className="grid gap-6 pt-6 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="OCR usage"
                  value={`${run.processing.ocr_usage_count}/${run.extraction.statements_tested || 0}`}
                />
                <Metric
                  label="AI fallback usage"
                  value={`${run.processing.ai_fallback_count}/${run.extraction.statements_tested || 0}`}
                />
                <Metric label="Failures" value={String(run.processing.failure_count)} />
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Parser used</p>
                  {Object.keys(run.processing.parser_counts).length === 0 ? (
                    <p className="font-display text-2xl tracking-tight">—</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {Object.entries(run.processing.parser_counts).map(([k, v]) => (
                        <li
                          key={k}
                          className="flex justify-between gap-4 border-b border-border/50 pb-1"
                        >
                          <span className="font-medium">{k}</span>
                          <span className="text-muted-foreground">{v}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          </section>

          {run.fixtures.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-xl tracking-tight">Suite fixture detail</h2>
              <Card>
                <CardContent className="space-y-0 pt-2">
                  {run.fixtures.map((f) => (
                    <div
                      key={f.fixture_name}
                      className="grid gap-2 border-b border-border/60 py-4 last:border-0 sm:grid-cols-[140px_1fr]"
                    >
                      <div>
                        <p className="font-medium uppercase tracking-wide">{f.fixture_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {f.parser_used || "—"}
                          {f.used_ocr ? " · OCR" : ""}
                          {f.failed ? " · failed" : ""}
                        </p>
                      </div>
                      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <span>
                          Recall {pct(f.recall)} · {f.matched}/{f.expected_count} matched
                        </span>
                        <span>
                          Missing {f.missing_rows} · Amt {f.wrong_amounts} · Date {f.wrong_dates}
                        </span>
                        <span>
                          Balance: {f.balance_tie_out}
                          {!f.bank_ok ? " · bank miss" : ""}
                        </span>
                        <span className="text-muted-foreground">
                          Pred {f.predicted_count} · {f.predicted_bank || "unknown bank"}
                        </span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>
          )}
        </>
      )}

      {!loading && !run && (
        <Card>
          <CardHeader>
            <CardTitle>Full suite not run yet</CardTitle>
            <CardDescription>
              Bank parser scores above load live. Use “Run full evaluation” for categorization and
              persisted history.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-xl tracking-tight">Run history</h2>
          <Card>
            <CardContent className="space-y-2 pt-4 text-sm">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-2 last:border-0"
                >
                  <span className="text-muted-foreground">
                    {h.created_at ? new Date(h.created_at).toLocaleString() : "—"} · {h.source} ·{" "}
                    {h.status}
                  </span>
                  <span>
                    {h.extraction.statements_tested} stmts · recall{" "}
                    {pct(h.extraction.transaction_recall)} · cat{" "}
                    {pct(h.categorization.category_accuracy)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function BankRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-display text-xl tracking-tight">{value}</dd>
    </div>
  );
}
