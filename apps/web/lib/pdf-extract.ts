import "server-only";
import { createRequire } from "module";
import { parseBankStatement, type ParseResult } from "@/lib/bank-parsers";

const require = createRequire(import.meta.url);

type PdfParseFn = (buf: Buffer) => Promise<{ text: string; numpages: number }>;

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdfParse = require("pdf-parse") as PdfParseFn;
  const result = await pdfParse(buffer);
  return result.text || "";
}

export async function extractTransactionsFromPdf(buffer: Buffer): Promise<ParseResult & { text_chars: number }> {
  const text = await extractTextFromPdf(buffer);
  const parsed = parseBankStatement(text);
  return { ...parsed, text_chars: text.length };
}
