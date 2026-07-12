import "server-only";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseBankStatement, type ParseResult, type ParsedTx } from "@/lib/bank-parsers";
import {
  attachSourceMeta,
  buildPageLayouts,
  buildTextFallbackLayouts,
  orderedTextFromLayouts,
  type Pdf2JsonData,
} from "@/lib/pdf-layout";

export type EnrichedTx = ParsedTx & {
  page_number: number | null;
  source_meta: Record<string, unknown> | null;
};

export type PdfExtraction = Omit<ParseResult, "transactions"> & {
  text_chars: number;
  page_count: number;
  transactions: EnrichedTx[];
};

type PdfParserInstance = {
  on(event: "pdfParser_dataError", cb: (err: { parserError: Error | string }) => void): void;
  on(event: "pdfParser_dataReady", cb: (data: Pdf2JsonData) => void): void;
  getRawTextContent(): string;
  parseBuffer(buffer: Buffer): void;
};

type PdfParserCtor = new (context: null, needRawText: boolean) => PdfParserInstance;

function resolvePdfParserCtor(mod: unknown): PdfParserCtor {
  if (typeof mod === "function") return mod as PdfParserCtor;
  if (mod && typeof mod === "object") {
    const rec = mod as Record<string, unknown>;
    if (typeof rec.default === "function") return rec.default as PdfParserCtor;
    if (typeof rec.PDFParser === "function") return rec.PDFParser as PdfParserCtor;
  }
  throw new Error("pdf2json did not export a parser constructor");
}

async function loadPdfParser(): Promise<PdfParserCtor> {
  try {
    const mod = await import("pdf2json");
    return resolvePdfParserCtor(mod.default ?? mod);
  } catch {
    /* try require */
  }

  try {
    const req = createRequire(resolve(process.cwd(), "package.json"));
    return resolvePdfParserCtor(req("pdf2json"));
  } catch {
    /* try import.meta */
  }

  try {
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const req = createRequire(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
    return resolvePdfParserCtor(req("pdf2json"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    throw new Error(`Could not load pdf2json: ${msg}`);
  }
}

async function parsePdfBuffer(buffer: Buffer): Promise<{ text: string; pdfData: Pdf2JsonData }> {
  const PDFParser = await loadPdfParser();

  return new Promise((resolvePromise, reject) => {
    const parser = new PDFParser(null, true);
    parser.on("pdfParser_dataError", (err) => {
      const msg =
        typeof err.parserError === "string"
          ? err.parserError
          : err.parserError?.message || "PDF parse failed";
      reject(new Error(msg));
    });
    parser.on("pdfParser_dataReady", (pdfData) => {
      const layouts = buildPageLayouts(pdfData);
      const ordered = orderedTextFromLayouts(layouts);
      const text = ordered.trim() || parser.getRawTextContent().trim();
      if (text.length < 20) {
        reject(new Error("Could not extract text from this PDF"));
        return;
      }
      resolvePromise({ text, pdfData });
    });
    parser.parseBuffer(buffer);
  });
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const { text } = await parsePdfBuffer(buffer);
  return text;
}

export async function extractTransactionsFromPdf(buffer: Buffer): Promise<PdfExtraction> {
  const { text, pdfData } = await parsePdfBuffer(buffer);
  let layouts = buildPageLayouts(pdfData);
  const layoutLines = layouts.reduce((n, l) => n + l.lines.length, 0);

  if (!layoutLines) {
    layouts = buildTextFallbackLayouts(text, pdfData.Pages?.length || 1);
  }

  const parsed = parseBankStatement(text, layouts);
  const pageCount = pdfData.Pages?.length || layouts.length || 1;

  function enrich(layoutsForMatch: typeof layouts): EnrichedTx[] {
    return parsed.transactions.map((tx) => {
      const { page_number, source_meta } = attachSourceMeta(layoutsForMatch, {
        transaction_date: tx.transaction_date,
        description: tx.description,
        debit: tx.debit,
        credit: tx.credit,
        page_hint: tx.page_hint ?? null,
      });
      return {
        ...tx,
        page_number: page_number ?? tx.page_hint ?? null,
        source_meta,
      };
    });
  }

  const transactions = enrich(layouts);

  return {
    ...parsed,
    transactions,
    text_chars: text.length,
    page_count: pageCount,
  };
}
