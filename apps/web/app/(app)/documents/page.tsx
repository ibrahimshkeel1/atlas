"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Upload, FileText, Loader2, Trash2, RefreshCw, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clientApi, uploadDocument, type DocumentItem } from "@/lib/api";
import { cn, formatMoney } from "@/lib/utils";
import { ExportWorkingPapersButtons } from "@/components/export-working-papers";
import { useClientContext } from "@/components/client-provider";

export default function DocumentsPage() {
  const { activeClientId } = useClientContext();
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    clientApi<DocumentItem[]>("/documents")
      .then(setDocs)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load, activeClientId]);

  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      await uploadDocument(file);
      load();
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      const detail = err instanceof Error ? err.message : "Upload failed";
      if (status === 409) {
        const ok = window.confirm(`${detail}\n\nUpload a copy anyway?`);
        if (ok) {
          try {
            await uploadDocument(file, { force: true });
            load();
            return;
          } catch (retryErr) {
            setError(retryErr instanceof Error ? retryErr.message : "Upload failed");
            return;
          }
        }
      }
      setError(detail);
    } finally {
      setUploading(false);
    }
  }

  async function reprocessDocument(doc: DocumentItem) {
    setReprocessingId(doc.id);
    setError("");
    try {
      await clientApi(`/documents/${doc.id}/reprocess`, { method: "POST" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reprocess failed");
    } finally {
      setReprocessingId(null);
    }
  }

  async function removeDocument(doc: DocumentItem) {
    const ok = window.confirm(
      `Delete “${doc.filename}”? This also removes its extracted transactions.`
    );
    if (!ok) return;
    setDeletingId(doc.id);
    setError("");
    try {
      const res = await fetch(`/api/proxy/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok) {
        let detail = "Delete failed";
        try {
          const body = await res.json();
          detail = body.detail || body.error || detail;
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Documents</h1>
          <p className="mt-1 text-muted-foreground">
            Upload bank statement PDFs for extraction and categorization.
          </p>
        </div>
        {docs.some((d) => d.status === "ready") && (
          <ExportWorkingPapersButtons size="sm" showPdf={false} />
        )}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-white/60 px-6 py-16 text-center transition-colors",
          dragging && "border-primary bg-accent/40"
        )}
      >
        <Upload className="mb-3 h-8 w-8 text-primary" />
        <p className="font-medium">Drag and drop a PDF bank statement</p>
        <p className="mt-1 text-sm text-muted-foreground">Max 20MB · PDF only</p>
        <label className="mt-4 cursor-pointer">
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
            }}
          />
          <Button type="button" disabled={uploading} asChild>
            <span>{uploading ? "Uploading…" : "Choose file"}</span>
          </Button>
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Processing queue</CardTitle>
          <CardDescription>Status updates automatically while jobs run</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {docs.length === 0 && (
            <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
          )}
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="flex items-start justify-between gap-4 border-b border-border/60 py-3 last:border-0"
            >
              <div className="flex min-w-0 items-start gap-3">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  {doc.status === "ready" || doc.status === "failed" ? (
                    <Link
                      href={`/documents/${doc.id}/review`}
                      className="text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {doc.filename}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium">{doc.filename}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {doc.bank_name || "Bank unknown"}
                    {doc.page_count ? ` · ${doc.page_count} pages` : ""}
                    {typeof doc.transaction_count === "number"
                      ? ` · ${doc.transaction_count} transactions`
                      : ""}
                    {doc.created_at ? ` · ${new Date(doc.created_at).toLocaleString()}` : ""}
                  </p>
                  <MetaLine meta={doc.extraction_meta} />
                  {doc.error_message && (
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        doc.status === "ready" ? "text-amber-700" : "text-destructive"
                      )}
                    >
                      {doc.error_message}
                    </p>
                  )}
                  {(doc.status === "ready" || doc.status === "failed") && (
                    <Button asChild size="sm" className="mt-2">
                      <Link href={`/documents/${doc.id}/review`}>
                        <FileSearch className="mr-1.5 h-3.5 w-3.5" />
                        PDF side-by-side
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <StatusBadge status={doc.status} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  disabled={
                    reprocessingId === doc.id ||
                    doc.status === "processing" ||
                    doc.status === "uploaded"
                  }
                  onClick={() => reprocessDocument(doc)}
                  aria-label={`Reprocess ${doc.filename}`}
                  title="Reprocess"
                >
                  {reprocessingId === doc.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  disabled={deletingId === doc.id}
                  onClick={() => removeDocument(doc)}
                  aria-label={`Delete ${doc.filename}`}
                >
                  {deletingId === doc.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function MetaLine({ meta }: { meta: DocumentItem["extraction_meta"] }) {
  if (!meta) return null;
  const parts: string[] = [];
  if (meta.method) parts.push(meta.method);
  if (meta.ai_fallback) parts.push("AI fallback");
  if (meta.used_ocr) parts.push("OCR");
  if (typeof meta.dropped_rows === "number" && meta.dropped_rows > 0) {
    parts.push(`${meta.dropped_rows} dropped`);
  }
  if (meta.tie_out === "match") parts.push("balance match");
  if (meta.tie_out === "mismatch") {
    parts.push(
      `balance off${
        meta.difference != null ? ` ${formatMoney(meta.difference)}` : ""
      }`
    );
  }
  if (meta.tie_out === "unknown") parts.push("balance unchecked");
  if (!parts.length) return null;
  return <p className="mt-1 text-xs text-muted-foreground">{parts.join(" · ")}</p>;
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "ready"
      ? "bg-accent text-accent-foreground"
      : status === "failed"
        ? "bg-red-50 text-red-700"
        : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs", tone)}>
      {(status === "processing" || status === "uploaded") && (
        <Loader2 className="h-3 w-3 animate-spin" />
      )}
      {status}
    </span>
  );
}
