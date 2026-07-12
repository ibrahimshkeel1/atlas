"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileSearch, SkipForward, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CategorySelect,
  type CategorySelectHandle,
} from "@/components/category-select";
import { RememberRulePrompt } from "@/components/remember-rule-prompt";
import { ExportWorkingPapersButtons } from "@/components/export-working-papers";
import {
  clientApi,
  type Category,
  type ReviewStatus,
  type RuleSuggestion,
  type Transaction,
} from "@/lib/api";
import { cn, formatMoney } from "@/lib/utils";

export default function TransactionsPage() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [needsReview, setNeedsReview] = useState<string>("all");
  const [sort, setSort] = useState("date_desc");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkCategory, setBulkCategory] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rulePrompt, setRulePrompt] = useState<RuleSuggestion | null>(null);
  const [rulePromptDescription, setRulePromptDescription] = useState("");
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus | null>(null);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  const categoryRefs = useRef<Record<string, CategorySelectHandle | null>>({});
  const rowsRef = useRef<Transaction[]>([]);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("needs_review") === "true") setNeedsReview("true");
  }, []);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ sort, limit: "200" });
      if (q) params.set("q", q);
      if (categoryId !== "all") params.set("category_id", categoryId);
      if (needsReview !== "all") params.set("needs_review", needsReview);
      const [txs, cats, status] = await Promise.all([
        clientApi<Transaction[]>(`/transactions?${params}`),
        clientApi<Category[]>("/categories"),
        clientApi<ReviewStatus>("/review/status"),
      ]);
      setRows(txs);
      setCategories(cats);
      setReviewStatus(status);
      setActiveId((prev) => {
        if (prev && txs.some((t) => t.id === prev)) return prev;
        return txs.find((t) => t.needs_review)?.id ?? txs[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [q, categoryId, needsReview, sort]);

  useEffect(() => {
    load();
  }, [load]);

  rowsRef.current = rows;
  activeIdRef.current = activeId;

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected]
  );
  const reviewCountView = useMemo(
    () => rows.filter((r) => r.needs_review).length,
    [rows]
  );
  const documentIds = useMemo(
    () => [...new Set(rows.map((r) => r.document_id).filter(Boolean))],
    [rows]
  );

  const orgRemaining = reviewStatus?.needs_review_count ?? reviewCountView;
  const orgTotal = reviewStatus?.transaction_count ?? rows.length;
  const orgReviewed = reviewStatus?.reviewed_count ?? Math.max(orgTotal - orgRemaining, 0);
  const progressPct = orgTotal ? Math.round((orgReviewed / orgTotal) * 100) : 100;

  const highConfPending = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.needs_review &&
          r.confidence_score != null &&
          Number(r.confidence_score) >= 0.7
      ).length,
    [rows]
  );

  function selectAt(index: number) {
    const list = rowsRef.current;
    if (index < 0 || index >= list.length) return;
    setActiveId(list[index].id);
  }

  function jumpNextIssue() {
    const list = rowsRef.current;
    if (!list.length) return;
    const start = list.findIndex((r) => r.id === activeIdRef.current);
    const from = start < 0 ? -1 : start;
    for (let i = 1; i <= list.length; i++) {
      const idx = (from + i) % list.length;
      if (list[idx].needs_review) {
        setActiveId(list[idx].id);
        return;
      }
    }
  }

  async function updateCategory(txId: string, nextCategoryId: string) {
    try {
      const updated = await clientApi<Transaction>(`/transactions/${txId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: nextCategoryId }),
      });
      setRows((prev) => prev.map((r) => (r.id === txId ? { ...r, ...updated } : r)));
      if (updated.rule_suggestion) {
        setRulePrompt(updated.rule_suggestion);
        const row = rowsRef.current.find((r) => r.id === txId);
        setRulePromptDescription(row?.description || updated.description || "");
      }
      setActiveId(txId);
      void clientApi<ReviewStatus>("/review/status").then(setReviewStatus).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Category update failed");
    }
  }

  async function markReviewed(txId: string) {
    try {
      const updated = await clientApi<Transaction>(`/transactions/${txId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ needs_review: false }),
      });
      setRows((prev) =>
        prev.map((r) => (r.id === txId ? { ...r, ...updated, rule_suggestion: null } : r))
      );
      requestAnimationFrame(() => jumpNextIssue());
      void clientApi<ReviewStatus>("/review/status").then(setReviewStatus).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function bulkUpdate() {
    if (!bulkCategory || selectedIds.length === 0) return;
    await clientApi("/transactions/bulk-category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_ids: selectedIds, category_id: bulkCategory }),
    });
    setSelected({});
    load();
  }

  async function bulkMarkReviewed() {
    if (selectedIds.length === 0) return;
    await clientApi("/transactions/bulk-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_ids: selectedIds, needs_review: false }),
    });
    setSelected({});
    load();
  }

  async function approveHighConfidence() {
    setApproving(true);
    setError("");
    try {
      const body: { transaction_ids?: string[] } = {};
      if (selectedIds.length > 0) body.transaction_ids = selectedIds;
      await clientApi("/transactions/bulk-approve-high-confidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setSelected({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setApproving(false);
    }
  }

  useEffect(() => {
    function isTypingTarget(el: EventTarget | null) {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      if (el.getAttribute("role") === "combobox" || el.getAttribute("role") === "listbox") {
        return true;
      }
      if (el.closest('[role="listbox"], [data-radix-select-content]')) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const list = rowsRef.current;
      const idx = list.findIndex((r) => r.id === activeIdRef.current);

      if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") {
        e.preventDefault();
        selectAt(idx < 0 ? 0 : idx + 1);
      } else if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") {
        e.preventDefault();
        selectAt(idx < 0 ? 0 : idx - 1);
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        jumpNextIssue();
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        const id = activeIdRef.current;
        if (id) categoryRefs.current[id]?.open();
      } else if (e.key === "Enter") {
        const tx = list[idx];
        if (tx?.needs_review) {
          e.preventDefault();
          void markReviewed(tx.id);
        }
      }
    }

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  function exportCsv() {
    const header = ["Date", "Description", "Debit", "Credit", "Balance", "Category", "Reference"];
    const lines = rows.map((r) =>
      [
        r.transaction_date,
        JSON.stringify(r.description),
        r.debit ?? "",
        r.credit ?? "",
        r.balance ?? "",
        r.category?.name ?? "",
        r.reference ?? "",
      ].join(",")
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "atlas-transactions.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl tracking-tight">Transactions</h1>
          <p className="mt-1 text-muted-foreground">
            Review faster than Excel —{" "}
            {orgRemaining > 0
              ? `${orgRemaining} remaining · ${orgReviewed}/${orgTotal} reviewed`
              : "queue clear"}
            {reviewCountView > 0 && needsReview === "true"
              ? ` · ${reviewCountView} in this view`
              : ""}
            .
          </p>
          <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={needsReview === "true" ? "default" : "outline"}
            onClick={() => setNeedsReview(needsReview === "true" ? "all" : "true")}
          >
            Needs review
          </Button>
          <Button type="button" variant="outline" onClick={jumpNextIssue}>
            <SkipForward className="mr-1.5 h-4 w-4" />
            Next issue
          </Button>
          {documentIds.length === 1 && (
            <Button asChild variant="outline">
              <Link
                href={`/documents/${documentIds[0]}/review${
                  needsReview === "true" ? "?needs_review=true" : ""
                }`}
              >
                <FileSearch className="mr-1.5 h-4 w-4" />
                PDF side-by-side
              </Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/categories">Categories</Link>
          </Button>
          <ExportWorkingPapersButtons
            size="default"
            compact
            showPdf={false}
            showReportsLink={false}
            periodStart={reviewStatus?.period_start}
            periodEnd={reviewStatus?.period_end}
          />
          <Button variant="outline" onClick={exportCsv}>
            CSV
          </Button>
        </div>
      </div>

      {rulePrompt && (
        <RememberRulePrompt
          suggestion={rulePrompt}
          description={rulePromptDescription}
          onDismiss={() => setRulePrompt(null)}
        />
      )}

      {(needsReview === "true" || orgRemaining > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p>
            {orgRemaining} left to review.{" "}
            {highConfPending > 0
              ? `${highConfPending} high-confidence in this view can be approved in one click.`
              : "Verify amounts against the PDF when unsure."}
          </p>
          <div className="flex flex-wrap gap-2">
            {highConfPending > 0 && (
              <Button size="sm" variant="outline" onClick={approveHighConfidence} disabled={approving}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {approving ? "Approving…" : "Approve high-confidence"}
              </Button>
            )}
            {documentIds.map((id) => (
              <Button key={id} asChild size="sm">
                <Link href={`/documents/${id}/review?needs_review=true`}>
                  <FileSearch className="mr-1.5 h-3.5 w-3.5" />
                  PDF review
                </Link>
              </Button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        <kbd className="rounded border bg-white px-1">j</kbd> /{" "}
        <kbd className="rounded border bg-white px-1">k</kbd> next/prev ·{" "}
        <kbd className="rounded border bg-white px-1">n</kbd> next issue ·{" "}
        <kbd className="rounded border bg-white px-1">c</kbd> category ·{" "}
        <kbd className="rounded border bg-white px-1">Enter</kbd> mark OK
      </p>

      <div className="grid gap-3 md:grid-cols-4">
        <Input
          placeholder="Search description…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <CategorySelect
          categories={categories}
          value={categoryId}
          onValueChange={setCategoryId}
          onCategoriesChange={setCategories}
          includeAllOption
          allowCreate={false}
          placeholder="Category"
        />
        <Select value={needsReview} onValueChange={setNeedsReview}>
          <SelectTrigger>
            <SelectValue placeholder="Review" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="true">Needs review</SelectItem>
            <SelectItem value="false">Reviewed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger>
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date_desc">Date ↓</SelectItem>
            <SelectItem value="date_asc">Date ↑</SelectItem>
            <SelectItem value="amount_desc">Amount ↓</SelectItem>
            <SelectItem value="amount_asc">Amount ↑</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-white/80 p-3">
          <span className="text-sm">{selectedIds.length} selected</span>
          <CategorySelect
            categories={categories}
            value={bulkCategory || undefined}
            onValueChange={setBulkCategory}
            onCategoriesChange={setCategories}
            placeholder="Set category"
            triggerClassName="w-52"
          />
          <Button size="sm" onClick={bulkUpdate}>
            Apply category
          </Button>
          <Button size="sm" variant="outline" onClick={bulkMarkReviewed}>
            Mark reviewed
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={approveHighConfidence}
            disabled={approving}
          >
            Approve high-confidence
          </Button>
          {(() => {
            const first = rows.find((r) => r.id === selectedIds[0]);
            if (!first?.document_id) return null;
            return (
              <Button asChild size="sm" variant="outline">
                <Link href={`/documents/${first.document_id}/review?tx=${first.id}`}>
                  <FileSearch className="mr-1.5 h-3.5 w-3.5" />
                  PDF review
                </Link>
              </Button>
            );
          })()}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-white/80">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-3"></th>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Description</th>
              <th className="px-3 py-3 text-right">Debit</th>
              <th className="px-3 py-3 text-right">Credit</th>
              <th className="px-3 py-3">Category</th>
              <th className="px-3 py-3">Review</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => setActiveId(row.id)}
                className={cn(
                  "border-b border-border/60 last:border-0",
                  activeId === row.id && "bg-accent/40"
                )}
              >
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={!!selected[row.id]}
                    onCheckedChange={(v) =>
                      setSelected((s) => ({ ...s, [row.id]: Boolean(v) }))
                    }
                  />
                </td>
                <td className="px-3 py-3 tabular-nums">{row.transaction_date}</td>
                <td className="px-3 py-3">
                  <div className="max-w-md">
                    <p className="font-medium">{row.description}</p>
                    {row.reference && (
                      <p className="text-xs text-muted-foreground">{row.reference}</p>
                    )}
                    <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {row.confidence_score != null && (
                        <span>Confidence {Number(row.confidence_score).toFixed(2)}</span>
                      )}
                      {row.suggested_category &&
                        row.suggested_category.id !== row.category_id && (
                          <span className="text-sky-800">
                            Suggested: {row.suggested_category.name}
                          </span>
                        )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.debit != null ? formatMoney(row.debit) : "—"}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.credit != null ? formatMoney(row.credit) : "—"}
                </td>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <CategorySelect
                    ref={(h) => {
                      categoryRefs.current[row.id] = h;
                    }}
                    categories={categories}
                    value={row.category_id || undefined}
                    onValueChange={(v) => updateCategory(row.id, v)}
                    onCategoriesChange={setCategories}
                    triggerClassName="h-8 w-48"
                    suggestedCategoryId={row.suggested_category?.id}
                    suggestedCategoryName={row.suggested_category?.name}
                  />
                </td>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {row.document_id && (
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/documents/${row.document_id}/review?tx=${row.id}${
                            row.needs_review ? "&needs_review=true" : ""
                          }`}
                        >
                          PDF
                        </Link>
                      </Button>
                    )}
                    {row.needs_review ? (
                      <Button size="sm" variant="outline" onClick={() => markReviewed(row.id)}>
                        Mark OK
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">OK</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  No transactions yet. Upload a statement to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
