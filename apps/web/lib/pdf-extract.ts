import { createRequire } from "module";
import { parseBankStatement, type ParseResult } from "@/lib/bank-parsers";

const require = createRequire(import.meta.url);

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // pdf-parse is CJS; load via createRequire for Next/Turbopack
  const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
  const result = await pdfParse(buffer);
  return result.text || "";
}

export async function extractTransactionsFromPdf(buffer: Buffer): Promise<ParseResult & { text_chars: number }> {
  const text = await extractTextFromPdf(buffer);
  const parsed = parseBankStatement(text);
  return { ...parsed, text_chars: text.length };
}
