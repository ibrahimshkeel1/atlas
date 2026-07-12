import "server-only";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBankStatement, type ParseResult, type ParsedTx } from "@/lib/bank-parsers";
import {
  attachSourceMeta,
  buildPageLayouts,
  buildTextFallbackLayouts,
  type Pdf2JsonData,
} from "@/lib/pdf-layout";

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), "..", "package.json")
);

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

async function parsePdfBuffer(buffer: Buffer): Promise<{ text: string; pdfData: Pdf2JsonData }> {
  const PDFParser = require("pdf2json") as new (
    context: null,
    needRawText: boolean
  ) => PdfParserInstance;

  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, true);
    parser.on("pdfParser_dataError", (err) => {
      const msg =
        typeof err.parserError === "string"
          ? err.parserError
          : err.parserError?.message || "PDF parse failed";
      reject(new Error(msg));
    });
    parser.on("pdfParser_dataReady", (pdfData) => {
      const text = parser.getRawTextContent().trim();
      if (text.length < 20) {
        reject(new Error("Could not extract text from this PDF"));
        return;
      }
      resolve({ text, pdfData });
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
  const parsed = parseBankStatement(text);
  const pageCount = pdfData.Pages?.length || 1;

  function enrich(layouts: ReturnType<typeof buildPageLayouts>): EnrichedTx[] {
    return parsed.transactions.map((tx) => {
      const { page_number, source_meta } = attachSourceMeta(layouts, tx);
      return { ...tx, page_number, source_meta };
    });
  }

  let layouts = buildPageLayouts(pdfData);
  let transactions = enrich(layouts);
  let withBbox = transactions.filter((t) => t.source_meta?.bbox_norm).length;

  if (!layouts.reduce((n, l) => n + l.lines.length, 0) || withBbox === 0) {
    layouts = buildTextFallbackLayouts(text, pageCount);
    transactions = enrich(layouts);
    withBbox = transactions.filter((t) => t.source_meta?.bbox_norm).length;
  }

  return {
    ...parsed,
    transactions,
    text_chars: text.length,
    page_count: pageCount || layouts.length || 0,
  };
}
