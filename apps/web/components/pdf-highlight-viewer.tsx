"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadBrowserPdfJs, type BrowserPdfDocument } from "@/lib/pdfjs-browser";
import type { BBoxNorm } from "@/lib/pdf-bbox";

export type { BBoxNorm } from "@/lib/pdf-bbox";
export { bboxFromSourceMeta } from "@/lib/pdf-bbox";

type Props = {
  url: string | null;
  page: number;
  highlight?: BBoxNorm | null;
  className?: string;
  onReady?: () => void;
};

export function PdfHighlightViewer({
  url,
  page,
  highlight,
  className,
  onReady,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<BrowserPdfDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.15);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!url) return;
      setLoading(true);
      setError("");
      try {
        const pdfjs = await loadBrowserPdfJs();

        if (pdfRef.current) {
          await pdfRef.current.destroy();
          pdfRef.current = null;
        }
        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        pdfRef.current = doc;
        setPageCount(doc.numPages);
        onReady?.();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not open PDF");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      void pdfRef.current?.destroy();
      pdfRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload when URL changes
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdf = pdfRef.current;
      const canvas = canvasRef.current;
      if (!pdf || !canvas || loading) return;
      const pageNum = Math.min(Math.max(1, page), pdf.numPages || 1);
      try {
        const pdfPage = await pdf.getPage(pageNum);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        setCanvasSize({ w: canvas.width, h: canvas.height });
        await pdfPage.render({
          canvasContext: ctx,
          viewport,
          canvas,
        }).promise;
        if (!cancelled) setPulse((n) => n + 1);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not render page");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, scale, loading, pageCount]);

  useEffect(() => {
    if (!highlight || !highlightRef.current || !scrollRef.current) return;
    highlightRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight, page, pulse, canvasSize.h]);

  const hasHighlight =
    !!highlight &&
    highlight.w > 0 &&
    highlight.h > 0 &&
    canvasSize.w > 0 &&
    canvasSize.h > 0;

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col bg-muted/30", className)}>
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8 bg-white/90"
          onClick={() => setScale((s) => Math.max(0.7, Number((s - 0.15).toFixed(2))))}
          aria-label="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8 bg-white/90"
          onClick={() => setScale((s) => Math.min(2.4, Number((s + 0.15).toFixed(2))))}
          aria-label="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-muted/40 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading PDF…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4 text-center text-sm text-destructive">
          {error}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-3">
        <div className="relative mx-auto w-fit shadow-sm">
          <canvas ref={canvasRef} className="block bg-white" />
          {hasHighlight && highlight && (
            <div
              ref={highlightRef}
              className="pointer-events-none absolute rounded-sm border-2 border-amber-500 bg-amber-300/35 shadow-[0_0_0_1px_rgba(245,158,11,0.35)] animate-[pulse_1.4s_ease-in-out_2]"
              style={{
                left: highlight.x * canvasSize.w,
                top: highlight.y * canvasSize.h,
                width: highlight.w * canvasSize.w,
                height: Math.max(highlight.h * canvasSize.h, 14),
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
