import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseBankStatement } from "../lib/bank-parsers.ts";
import { buildPageLayouts, attachSourceMeta } from "../lib/pdf-layout.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, "..", "package.json"));
const PDFParser = require("pdf2json");

const buf = readFileSync(join(__dirname, "../../../M|06-2026.pdf"));

const { text, pdfData } = await new Promise((resolve, reject) => {
  const parser = new PDFParser(null, true);
  parser.on("pdfParser_dataError", (err) => reject(err.parserError));
  parser.on("pdfParser_dataReady", (pdfData) => {
    resolve({ text: parser.getRawTextContent().trim(), pdfData });
  });
  parser.parseBuffer(buf);
});

const parsed = parseBankStatement(text);
const layouts = buildPageLayouts(pdfData);
const enriched = parsed.transactions.map((tx) => ({
  ...tx,
  ...attachSourceMeta(layouts, tx),
}));
const withBbox = enriched.filter((t) => t.source_meta?.bbox_norm);

console.log("tx:", parsed.transactions.length, "with bbox:", withBbox.length);
console.log("sample desc:", parsed.transactions[0]?.description);
console.log("sample meta:", JSON.stringify(withBbox[0]?.source_meta));
const missing = enriched.filter((t) => !t.source_meta?.bbox_norm);
console.log("missing count:", missing.length);
console.log("missing sample:", missing[0]?.description);
