"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CategorySelect,
  type CategorySelectHandle,
} from "@/components/category-select";
import { RememberRulePrompt } from "@/components/remember-rule-prompt";
import { ExportWorkingPapersButtons } from "@/components/export-working-papers";
import { bboxFromSourceMeta } from "@/lib/pdf-bbox";
import {
  clientApi,
  type Category,
  type DocumentItem,
  type RuleSuggestion,
  type Transaction,
} from "@/lib/api";
import { cn, formatMoney } from "@/lib/utils";

const PdfHighlightViewer = dynamic(
  () =>
    import("@/components/pdf-highlight-viewer").then((m) => m.PdfHighlightViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[320px] flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading PDF viewer…
      </div>
    ),
  }
);

function confidenceHint(score: number | string | null | undefined) {
  if (score == null) return { label: "Unknown confidence", tone: "text-muted-foreground" };
  const pct = Math.round(Number(score) * 100);
  if (pct >= 85) return { label: `Looks reliable (${pct}%)`, tone: "text-emerald-700" };
  if (pct >= 70) return { label: `Worth a quick check (${pct}%)`, tone: "text-amber-700" };
  return { label: `Please verify carefully (${pct}%)`, tone: "text-red-700" };
}

function formatDisplayDate(iso: string) {
  try {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function DocumentReviewPage() {
  const params = useParams<{ id: string }>();
  const documentId = params.id;

  const [doc, setDoc] = useState<DocumentItem | null>(null);
  const [rows, setRows] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [filterReview, setFilterReview] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [rulePrompt, setRulePrompt] = useState<RuleSuggestion | null>(null);
  const [rulePromptDescription, setRulePromptDescription] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<CategorySelectHandle>(null);
  const navRef = useRef({ selectedIndex: -1, visible: [] as Transaction[] });
  const markReviewedRef = useRef<(tx: Transaction) => Promise<void>>(async () => {});
  const openCategoryRef = useRef(() => {});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const search = new URLSearchParams(window.location.search);
        const txParam = search.get("tx");
        const reviewOnly = search.get("needs_review") === "true";
        if (reviewOnly) setFilterReview(true);

        const [d, txs, cats] = await Promise.all([
          clientApi<DocumentItem>(`/documents/${documentId}`),
          clientApi<Transaction[]>(
            `/transactions?document_id=${documentId}&sort=page_asc&limit=500`
          ),
          clientApi<Category[]>("/categories"),
        ]);
        if (cancelled) return;
        setDoc(d);
        setRows(txs);
        setCategories(cats);
        setSelectedId((prev) => {
          if (txParam && txs.some((t) => t.id === txParam)) return txParam;
          if (prev && txs.some((t) => t.id === prev)) return prev;
          const pool = reviewOnly ? txs.filter((t) => t.needs_review) : txs;
          const firstReview = pool.find((t) => t.needs_review);
          return (firstReview || pool[0] || txs[0])?.id ?? null;
        });
        // Keep keyboard focus on the review panel, not the PDF iframe
        requestAnimationFrame(() => panelRef.current?.focus());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/proxy/documents/${documentId}/file`);
        if (!res.ok) throw new Error("Could not load PDF");
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoked = url;
        setPdfUrl(url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "PDF load failed");
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [documentId]);

  const visible = useMemo(
    () => (filterReview ? rows.filter((r) => r.needs_review) : rows),
    [rows, filterReview]
  );

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) || null,
    [rows, selectedId]
  );

  const selectedIndex = useMemo(
    () => visible.findIndex((r) => r.id === selectedId),
    [visible, selectedId]
  );

  navRef.current = { selectedIndex, visible };

  useEffect(() => {
    if (selected?.page_number) setPdfPage(selected.page_number);
  }, [selected?.id, selected?.page_number]);

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-tx-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const selectAt = useCallback((index: number) => {
    const { visible: list } = navRef.current;
    if (index < 0 || index >= list.length) return;
    setSelectedId(list[index].id);
    panelRef.current?.focus();
  }, []);

  const jumpNextReview = useCallback(() => {
    const { visible: list, selectedIndex: startIdx } = navRef.current;
    if (!list.length) return;
    const start = startIdx < 0 ? -1 : startIdx;
    for (let i = 1; i <= list.length; i++) {
      const idx = (start + i) % list.length;
      if (list[idx].needs_review) {
        setSelectedId(list[idx].id);
        panelRef.current?.focus();
        return;
      }
    }
  }, []);

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

      const { selectedIndex: idx, visible: list } = navRef.current;
      if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") {
        e.preventDefault();
        selectAt(idx < 0 ? 0 : idx + 1);
      } else if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") {
        e.preventDefault();
        selectAt(idx < 0 ? 0 : idx - 1);
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        jumpNextReview();
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        openCategoryRef.current();
      } else if (e.key === "Enter") {
        const tx = list[idx] || rows.find((r) => r.id === selectedId);
        if (tx?.needs_review) {
          e.preventDefault();
          void markReviewedRef.current(tx);
        }
      }
    }

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selectAt, jumpNextReview, selectedId, rows]);

  async function markReviewed(tx: Transaction) {
    try {
      const updated = await clientApi<Transaction>(`/transactions/${tx.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ needs_review: false }),
      });
      setRows((prev) => prev.map((r) => (r.id === tx.id ? { ...r, ...updated, rule_suggestion: null } : r)));
      requestAnimationFrame(() => jumpNextReview());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }
  markReviewedRef.current = markReviewed;
  openCategoryRef.current = () => categoryRef.current?.open();

  async function updateCategory(tx: Transaction, categoryId: string) {
    try {
      const updated = await clientApi<Transaction>(`/transactions/${tx.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: categoryId }),
      });
      setRows((prev) =>
        prev.map((r) => (r.id === tx.id ? { ...r, ...updated } : r))
      );
      if (updated.rule_suggestion) {
        setRulePrompt(updated.rule_suggestion);
        setRulePromptDescription(tx.description);
      }
      panelRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Category update failed");
    }
  }

  const reviewCount = rows.filter((r) => r.needs_review).length;
  const reviewedCount = rows.length - reviewCount;
  const progressPct = rows.length ? Math.round((reviewedCount / rows.length) * 100) : 100;
  const conf = confidenceHint(selected?.confidence_score);
  const highlight = bboxFromSourceMeta(selected?.source_meta);
  const missingHighlights =
    rows.length > 0 && rows.every((r) => !bboxFromSourceMeta(r.source_meta));

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading review…
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-5.5rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/documents"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Documents
          </Link>
          <h1 className="truncate font-display text-2xl tracking-tight">
            {doc?.filename || "Statement review"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Compare the PDF on the left with each line on the right.
            {reviewCount
              ? ` ${reviewCount} remaining · ${reviewedCount}/${rows.length} reviewed.`
              : " All lines reviewed."}
          </p>
          <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={filterReview ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterReview((v) => !v)}
          >
            Needs review only
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={jumpNextReview}>
            <SkipForward className="mr-1 h-3.5 w-3.5" />
            Next issue
          </Button>
          {reviewCount === 0 && (
            <ExportWorkingPapersButtons
              size="sm"
              compact
              showPdf={false}
              showReportsLink={false}
            />
          )}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => selectAt(selectedIndex - 1)}
              disabled={selectedIndex <= 0}
              aria-label="Previous line"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => selectAt(selectedIndex + 1)}
              disabled={selectedIndex < 0 || selectedIndex >= visible.length - 1}
              aria-label="Next line"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {rulePrompt && (
        <RememberRulePrompt
          suggestion={rulePrompt}
          description={rulePromptDescription}
          onDismiss={() => setRulePrompt(null)}
        />
      )}
      <p className="text-xs text-muted-foreground">
        <kbd className="rounded border bg-white px-1">j</kbd> /{" "}
        <kbd className="rounded border bg-white px-1">k</kbd> next/prev ·{" "}
        <kbd className="rounded border bg-white px-1">n</kbd> next issue ·{" "}
        <kbd className="rounded border bg-white px-1">c</kbd> category ·{" "}
        <kbd className="rounded border bg-white px-1">Enter</kbd> mark OK
        {highlight ? " · amber box marks the line on the PDF" : ""}
      </p>
      {missingHighlights && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          PDF line highlights are missing for this statement. Open{" "}
          <Link href="/documents" className="underline underline-offset-2">
            Documents
          </Link>{" "}
          and click <span className="font-medium">Reprocess</span> once more to rebuild highlight
          boxes from the PDF layout.
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <div className="flex min-h-[320px] flex-col overflow-hidden rounded-xl border border-border/80 bg-white/70">
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
            <span>Original bank PDF</span>
            <span>
              Showing page {pdfPage}
              {doc?.page_count ? ` of ${doc.page_count}` : ""}
              {highlight ? " · line highlighted" : ""}
            </span>
          </div>
          {pdfUrl ? (
            <PdfHighlightViewer
              url={pdfUrl}
              page={pdfPage}
              highlight={highlight}
              onReady={() => panelRef.current?.focus()}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading PDF…
            </div>
          )}
        </div>

        <div
          ref={panelRef}
          tabIndex={0}
          onMouseEnter={() => panelRef.current?.focus()}
          className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-white/70 outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
            {filterReview ? "Lines that need a check" : "All extracted lines"}
            {selectedIndex >= 0 ? ` · ${selectedIndex + 1} of ${visible.length}` : ""}
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">Nothing in this list.</p>
            )}
            {visible.map((tx) => {
              const moneyOut = tx.debit != null;
              return (
                <div
                  key={tx.id}
                  role="button"
                  tabIndex={-1}
                  data-tx-id={tx.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSelectedId(tx.id);
                    panelRef.current?.focus();
                  }}
                  className={cn(
                    "w-full cursor-pointer border-b border-border/50 px-3 py-2.5 text-left transition-colors",
                    selectedId === tx.id ? "bg-accent/60" : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{tx.description}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDisplayDate(tx.transaction_date)}
                        {tx.page_number ? ` · page ${tx.page_number}` : ""}
                        {tx.category ? ` · ${tx.category.name}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      {moneyOut ? (
                        <p className="font-medium text-red-700">-{formatMoney(tx.debit)}</p>
                      ) : tx.credit != null ? (
                        <p className="font-medium text-emerald-700">+{formatMoney(tx.credit)}</p>
                      ) : (
                        <p>—</p>
                      )}
                      {tx.needs_review ? (
                        <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                          Check
                        </span>
                      ) : (
                        <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          Done
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {selected && (
            <div className="border-t border-border/60 bg-muted/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Selected line
                  </p>
                  <p className="mt-1 text-base font-semibold leading-snug">{selected.description}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatDisplayDate(selected.transaction_date)}
                    {selected.page_number
                      ? ` · see PDF page ${selected.page_number}`
                      : " · page not linked"}
                    {highlight ? " · line marked on PDF" : ""}
                  </p>
                </div>
                <div className="text-right">
                  {selected.debit != null ? (
                    <>
                      <p className="text-xs text-muted-foreground">Money out</p>
                      <p className="font-display text-2xl text-red-700">
                        {formatMoney(selected.debit)}
                      </p>
                    </>
                  ) : selected.credit != null ? (
                    <>
                      <p className="text-xs text-muted-foreground">Money in</p>
                      <p className="font-display text-2xl text-emerald-700">
                        {formatMoney(selected.credit)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No amount</p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {selected.needs_review ? (
                  <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
                    Needs your check
                  </span>
                ) : (
                  <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                    Marked OK
                  </span>
                )}
                <span className={cn("text-xs", conf.tone)}>{conf.label}</span>
                {selected.suggested_category && (
                  <span className="rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-900">
                    Suggested: {selected.suggested_category.name}
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <div className="min-w-[180px]">
                  <p className="mb-1 text-xs text-muted-foreground">Category</p>
                  <CategorySelect
                    ref={categoryRef}
                    categories={categories}
                    value={selected.category_id || undefined}
                    onValueChange={(v) => updateCategory(selected, v)}
                    onCategoriesChange={setCategories}
                    triggerClassName="h-9 w-[220px]"
                    suggestedCategoryId={selected.suggested_category?.id}
                    suggestedCategoryName={selected.suggested_category?.name}
                  />
                </div>
                {selected.needs_review && (
                  <div className="pt-5">
                    <Button type="button" onClick={() => markReviewed(selected)}>
                      Looks correct — mark OK
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
