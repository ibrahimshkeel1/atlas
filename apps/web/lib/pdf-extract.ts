import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { parseBankStatement, type ParseResult } from "@/lib/bank-parsers";

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

export async function extractTransactionsFromPdf(buffer: Buffer): Promise<ParseResult & { text_chars: number }> {
  const text = await extractTextFromPdf(buffer);
  const parsed = parseBankStatement(text);
  return { ...parsed, text_chars: text.length };
}
