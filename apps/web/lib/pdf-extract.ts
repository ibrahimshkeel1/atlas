import "server-only";
import { parseBankStatement, type ParseResult } from "@/lib/bank-parsers";

type PdfParserInstance = {
  on(event: "pdfParser_dataError", cb: (err: { parserError: Error | string }) => void): void;
  on(event: "pdfParser_dataReady", cb: () => void): void;
  getRawTextContent(): string;
  parseBuffer(buffer: Buffer): void;
};

type PdfParserCtor = new (context: null, needRawText: boolean) => PdfParserInstance;

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const mod = await import("pdf2json");
  const PDFParser = (mod.default ?? mod) as PdfParserCtor;

  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, true);
    parser.on("pdfParser_dataError", (err) => {
      const msg =
        typeof err.parserError === "string"
          ? err.parserError
          : err.parserError?.message || "PDF parse failed";
      reject(new Error(msg));
    });
    parser.on("pdfParser_dataReady", () => {
      const text = parser.getRawTextContent().trim();
      if (text.length < 20) {
        reject(new Error("Could not extract text from this PDF"));
        return;
      }
      resolve(text);
    });
    parser.parseBuffer(buffer);
  });
}

export async function extractTransactionsFromPdf(buffer: Buffer): Promise<ParseResult & { text_chars: number }> {
  const text = await extractTextFromPdf(buffer);
  const parsed = parseBankStatement(text);
  return { ...parsed, text_chars: text.length };
}
