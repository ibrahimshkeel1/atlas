/** Load pdf.js in the browser only — never bundle npm pdfjs-dist (avoids DOMMatrix on server). */

const PDFJS_VERSION = "4.10.38";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build`;

export type BrowserPdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<BrowserPdfPage>;
  destroy: () => Promise<void>;
};

export type BrowserPdfPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    canvas?: HTMLCanvasElement;
  }) => { promise: Promise<void> };
};

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { url: string }) => { promise: Promise<BrowserPdfDocument> };
};

let loading: Promise<PdfJsModule> | null = null;

export async function loadBrowserPdfJs(): Promise<PdfJsModule> {
  if (typeof window === "undefined") {
    throw new Error("PDF viewer is only available in the browser");
  }
  if (loading) return loading;

  loading = (async () => {
    const pdfjs = (await import(
      /* webpackIgnore: true */
      `${PDFJS_BASE}/pdf.min.mjs`
    )) as PdfJsModule;
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
    return pdfjs;
  })();

  return loading;
}
