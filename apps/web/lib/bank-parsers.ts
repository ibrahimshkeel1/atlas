export type ParsedTx = {
  transaction_date: string;
  description: string;
  debit: string | null;
  credit: string | null;
  balance: string | null;
  confidence: number;
};

export type ParseResult = {
  bank_name: string | null;
  transactions: ParsedTx[];
  method: string;
};

function money(v: string | undefined | null): string | null {
  if (!v) return null;
  return v.replace(/,/g, "");
}

function makeTx(
  date: string,
  desc: string,
  debit: string | null,
  credit: string | null,
  balance: string | null,
  confidence: number,
  seen: Set<string>
): ParsedTx | null {
  const clean = desc.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const key = `${date}|${clean}|${debit}|${credit}`;
  if (seen.has(key)) return null;
  seen.add(key);
  return {
    transaction_date: date,
    description: clean.slice(0, 500),
    debit,
    credit,
    balance,
    confidence,
  };
}

function parseMeezan(text: string): ParseResult {
  const moneyRe = String.raw`(?:Rs\.?|PKR)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{2})`;
  const lineRe = new RegExp(
    String.raw`(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})\s+(.+?)([+\-])\s*${moneyRe}(?:\s+(?:Rs\.?|PKR)\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}))?`,
    "i"
  );
  const seen = new Set<string>();
  const txs: ParsedTx[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 12 || !/Rs\.?|PKR/i.test(line)) continue;
    const m = lineRe.exec(line);
    if (!m) continue;
    const d = new Date(m[1]);
    if (Number.isNaN(d.getTime())) continue;
    const iso = d.toISOString().slice(0, 10);
    const amount = money(m[4]);
    const sign = m[3];
    const debit = sign === "-" ? amount : null;
    const credit = sign === "+" ? amount : null;
    let desc = m[2].replace(/[+\-]?\s*(?:Rs\.?|PKR)?\s*\d[\d,]*\.?\d{0,2}\s*$/i, "");
    const tx = makeTx(iso, desc, debit, credit, money(m[5]), 0.78, seen);
    if (tx) txs.push(tx);
  }
  return { bank_name: txs.length ? "Meezan" : null, transactions: txs, method: "meezan" };
}

function parseHbl(text: string): ParseResult {
  const re =
    /(\d{4}-\d{2}-\d{2})\s+(.+?)\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+\.\d{2})?\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+\.\d{2})?\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+\.\d{2})/g;
  const seen = new Set<string>();
  const txs: ParsedTx[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const debit = money(m[3]);
    const credit = money(m[4]);
    const balance = money(m[5]);
    const tx = makeTx(m[1], m[2], debit, credit, balance, 0.75, seen);
    if (tx) txs.push(tx);
  }
  return { bank_name: txs.length ? "HBL" : null, transactions: txs, method: "hbl" };
}

function parseUbl(text: string): ParseResult {
  const re =
    /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(DR|CR)\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+\.\d{2})\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+\.\d{2})/gi;
  const seen = new Set<string>();
  const txs: ParsedTx[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [dd, mm, yyyy] = m[1].split("/");
    const iso = `${yyyy}-${mm}-${dd}`;
    const amount = money(m[4]);
    const debit = m[3].toUpperCase() === "DR" ? amount : null;
    const credit = m[3].toUpperCase() === "CR" ? amount : null;
    const tx = makeTx(iso, m[2], debit, credit, money(m[5]), 0.75, seen);
    if (tx) txs.push(tx);
  }
  return { bank_name: txs.length ? "UBL" : null, transactions: txs, method: "ubl" };
}

export function parseBankStatement(text: string): ParseResult {
  const low = text.toLowerCase();
  const candidates = [
    low.includes("meezan") ? parseMeezan(text) : null,
    low.includes("hbl") || low.includes("habib") ? parseHbl(text) : null,
    low.includes("ubl") || low.includes("united bank") ? parseUbl(text) : null,
    parseMeezan(text),
    parseHbl(text),
    parseUbl(text),
  ].filter(Boolean) as ParseResult[];

  candidates.sort((a, b) => b.transactions.length - a.transactions.length);
  return (
    candidates[0] || {
      bank_name: null,
      transactions: [],
      method: "none",
    }
  );
}
