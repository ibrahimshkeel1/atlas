"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clientApi } from "@/lib/api";
import { cn } from "@/lib/utils";

type Bounds = {
  period_start: string | null;
  period_end: string | null;
  transaction_count: number;
};

type Props = {
  /** ISO dates — if omitted, uses full transaction date range from the API */
  periodStart?: string | null;
  periodEnd?: string | null;
  reportType?: string;
  className?: string;
  size?: "default" | "sm";
  showPdf?: boolean;
  excelPrimary?: boolean;
  compact?: boolean;
  showReportsLink?: boolean;
};

async function resolvePeriod(
  periodStart?: string | null,
  periodEnd?: string | null
): Promise<{ start: string; end: string }> {
  if (periodStart && periodEnd) {
    return { start: periodStart, end: periodEnd };
  }
  const bounds = await clientApi<Bounds>("/reports/bounds");
  if (!bounds.period_start || !bounds.period_end) {
    throw new Error("No transactions to export yet");
  }
  return { start: bounds.period_start, end: bounds.period_end };
}

export function ExportWorkingPapersButtons({
  periodStart,
  periodEnd,
  reportType = "cash_flow",
  className,
  size = "default",
  showPdf = true,
  excelPrimary = true,
  compact = false,
  showReportsLink = true,
}: Props) {
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const [error, setError] = useState("");

  const exportPack = useCallback(
    async (format: "xlsx" | "pdf", force = false) => {
      setBusy(format);
      setError("");
      try {
        const { start, end } = await resolvePeriod(periodStart, periodEnd);
        const data = await clientApi<{ download_url: string }>("/reports/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            report_type: reportType,
            period_start: start,
            period_end: end,
            format,
            force,
          }),
        });
        window.open(data.download_url, "_blank");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Export failed";
        if (!force && /need review|still need review/i.test(msg)) {
          const ok = window.confirm(
            `${msg}\n\nExport working papers anyway? (Needs review rows stay flagged in the file.)`
          );
          if (ok) {
            await exportPack(format, true);
            return;
          }
          setError("");
          return;
        }
        setError(msg);
      } finally {
        setBusy(null);
      }
    },
    [periodStart, periodEnd, reportType]
  );

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size={size}
          variant={excelPrimary ? "default" : "outline"}
          disabled={busy !== null}
          onClick={() => exportPack("xlsx")}
        >
          {busy === "xlsx" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-4 w-4" />
          )}
          {compact ? "Excel" : "Export Excel"}
        </Button>
        {showPdf && (
          <Button
            type="button"
            size={size}
            variant="outline"
            disabled={busy !== null}
            onClick={() => exportPack("pdf")}
          >
            {busy === "pdf" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            {compact ? "PDF" : "Export PDF"}
          </Button>
        )}
        {showReportsLink && (
          <Button asChild size={size} variant="ghost">
            <Link href="/reports">
              <Download className="h-4 w-4" />
              Reports
            </Link>
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
