type PdfTextRun = { T?: string; TS?: number[] };
type PdfTextItem = { x: number; y: number; w: number; R?: PdfTextRun[] };
type PdfPage = { Width: number; Height: number; Texts?: PdfTextItem[] };
export type Pdf2JsonData = { Pages?: PdfPage[] };

export type PageLine = {
  text: string;
  x0: number;
  top: number;
  x1: number;
  bottom: number;
};

export type PageLayout = {
  page: number;
  width: number;
  height: number;
  lines: PageLine[];
};

export type TxForLayout = {
  transaction_date: string;
  description: string;
  debit?: string | null;
  credit?: string | null;
  page_hint?: number | null;
};

function decodeText(runs: PdfTextRun[] | undefined): string {
  return (runs || [])
    .map((r) => {
      try {
        return decodeURIComponent(r.T || "");
      } catch {
        return r.T || "";
      }
    })
    .join("");
}

function mergeItems(items: PdfTextItem[]): PageLine {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const text = sorted.map((i) => decodeText(i.R)).join(" ").replace(/\s+/g, " ").trim();
  const heights = sorted.map((i) => {
    const ts = i.R?.[0]?.TS;
    return ts && ts[1] ? ts[1] / 10 : 2.2;
  });
  const h = Math.max(...heights, 2);
  return {
    text,
    x0: Math.min(...sorted.map((i) => i.x)),
    top: Math.min(...sorted.map((i) => i.y)),
    x1: Math.max(...sorted.map((i) => i.x + i.w)),
    bottom: Math.min(...sorted.map((i) => i.y)) + h,
  };
}

export function buildPageLayouts(pdfData: Pdf2JsonData): PageLayout[] {
  const layouts: PageLayout[] = [];
  for (let i = 0; i < (pdfData.Pages?.length || 0); i++) {
    const page = pdfData.Pages![i]!;
    const width = page.Width || 1;
    const height = page.Height || 1;
    const items = page.Texts || [];
    const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    const lines: PageLine[] = [];
    let bucket: PdfTextItem[] = [];
    let bucketY: number | null = null;
    for (const item of sorted) {
      const text = decodeText(item.R);
      if (!text.trim()) continue;
      if (bucketY === null || Math.abs(item.y - bucketY) < 1.2) {
        bucket.push(item);
        bucketY = bucketY ?? item.y;
      } else {
        if (bucket.length) lines.push(mergeItems(bucket));
        bucket = [item];
        bucketY = item.y;
      }
    }
    if (bucket.length) lines.push(mergeItems(bucket));
    layouts.push({ page: i + 1, width, height, lines });
  }
  return layouts;
}

/** Statement text in visual top-to-bottom order (pdf2json getRawTextContent is reversed). */
export function orderedTextFromLayouts(layouts: PageLayout[]): string {
  const parts: string[] = [];
  for (const layout of layouts) {
    for (const line of layout.lines) {
      if (line.text.trim()) parts.push(line.text);
    }
  }
  return parts.join("\n");
}

/** Fallback when pdf2json returns text but no positioned glyphs (some serverless builds). */
export function buildTextFallbackLayouts(rawText: string, pageCount = 1): PageLayout[] {
  const chunks = rawText.split(/\f+/).filter((c) => c.trim());
  const pages = chunks.length > 1 ? chunks : null;
  const width = 37.188;
  const height = 52.625;
  const lineHeight = height / 55;

  const buildPage = (text: string, page: number): PageLayout => {
    const lines: PageLine[] = [];
    const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    rows.forEach((row, i) => {
      lines.push({
        text: row,
        x0: 1,
        top: 2 + i * lineHeight,
        x1: width - 1,
        bottom: 2 + (i + 1) * lineHeight,
      });
    });
    return { page, width, height, lines };
  };

  if (pages) return pages.map((text, i) => buildPage(text, i + 1));

  const allLines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const perPage = Math.max(Math.ceil(allLines.length / Math.max(pageCount, 1)), 1);
  const layouts: PageLayout[] = [];
  for (let p = 0; p < Math.max(pageCount, 1); p++) {
    const slice = allLines.slice(p * perPage, (p + 1) * perPage);
    layouts.push(buildPage(slice.join("\n"), p + 1));
  }
  return layouts.filter((l) => l.lines.length > 0);
}

function normTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

function dateNeedles(iso: string): string[] {
  if (!iso || iso.length < 10) return [];
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return [];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return [
    `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${yyyy}`,
    `${dd}/${mm}/${yyyy}`,
    `${dd}-${mm}-${yyyy}`,
    iso,
  ];
}

function amountNeedles(debit?: string | null, credit?: string | null): string[] {
  const out: string[] = [];
  for (const raw of [debit, credit]) {
    if (!raw) continue;
    const n = Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const plain = n.toFixed(2);
    const comma = plain.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    for (const amt of [plain, comma]) {
      out.push(`Rs. ${amt}`, `Rs.${amt}`, `-Rs. ${amt}`, `+Rs. ${amt}`, amt);
    }
  }
  return [...new Set(out)];
}

function bboxPayload(layout: PageLayout, line: PageLine, match: string, needle: string) {
  const padX = 1.5;
  const padY = 0.8;
  const x0 = Math.max(0, line.x0 - padX);
  const top = Math.max(0, line.top - padY);
  const x1 = Math.min(layout.width, line.x1 + padX);
  const bottom = Math.min(layout.height, line.bottom + padY);
  return {
    match,
    needle: needle.slice(0, 64),
    bbox_norm: {
      x: x0 / layout.width,
      y: top / layout.height,
      w: Math.max((x1 - x0) / layout.width, 0.01),
      h: Math.max((bottom - top) / layout.height, 0.008),
    },
    page_width: layout.width,
    page_height: layout.height,
  };
}

function scoreLine(line: PageLine, description: string): number {
  const desc = new Set(normTokens(description));
  if (!desc.size) return 0;
  const lineTokens = new Set(normTokens(line.text));
  let score = 0;
  for (const t of desc) if (lineTokens.has(t)) score += 1;
  return score;
}

function expandedSearchLines(layout: PageLayout): PageLine[] {
  const base = layout.lines;
  const merged: PageLine[] = [];
  for (let i = 0; i < base.length; i++) {
    merged.push(base[i]!);
    if (i + 1 < base.length) {
      const a = base[i]!;
      const b = base[i + 1]!;
      if (b.top - a.bottom < 5) {
        merged.push({
          text: `${a.text} ${b.text}`.replace(/\s+/g, " ").trim(),
          x0: Math.min(a.x0, b.x0),
          top: a.top,
          x1: Math.max(a.x1, b.x1),
          bottom: b.bottom,
        });
      }
    }
    if (i + 2 < base.length) {
      const a = base[i]!;
      const b = base[i + 1]!;
      const c = base[i + 2]!;
      if (c.top - a.bottom < 8) {
        merged.push({
          text: `${a.text} ${b.text} ${c.text}`.replace(/\s+/g, " ").trim(),
          x0: Math.min(a.x0, b.x0, c.x0),
          top: a.top,
          x1: Math.max(a.x1, b.x1, c.x1),
          bottom: c.bottom,
        });
      }
    }
  }
  return merged;
}

function findLineHit(
  layout: PageLayout,
  needles: string[]
): { line: PageLine; needle: string } | null {
  const lines = expandedSearchLines(layout);
  for (const needle of needles) {
    if (!needle || needle.length < 3) continue;
    const low = needle.toLowerCase();
    const hit = lines.find((line) => line.text.toLowerCase().includes(low));
    if (hit) return { line: hit, needle };
  }
  return null;
}

export function attachSourceMeta(
  layouts: PageLayout[],
  tx: TxForLayout
): { page_number: number | null; source_meta: Record<string, unknown> | null } {
  const desc = tx.description.trim();
  const descNeedles = [
    desc,
    desc.slice(0, 64),
    desc.slice(0, 48),
    desc.slice(0, 32),
    desc.slice(0, 24),
    ...normTokens(desc).slice(0, 4),
  ].filter((n, i, arr) => n.length >= 4 && arr.indexOf(n) === i);

  const amountHits = amountNeedles(tx.debit, tx.credit);
  const dates = dateNeedles(tx.transaction_date);

  const layoutOrder =
    tx.page_hint != null
      ? [
          ...layouts.filter((l) => l.page === tx.page_hint),
          ...layouts.filter((l) => l.page !== tx.page_hint),
        ]
      : layouts;

  for (const layout of layoutOrder) {
    const hit = findLineHit(layout, descNeedles);
    if (hit) {
      return {
        page_number: layout.page,
        source_meta: bboxPayload(layout, hit.line, "description", hit.needle),
      };
    }
  }

  for (const layout of layoutOrder) {
    const hit = findLineHit(layout, amountHits);
    if (hit) {
      return {
        page_number: layout.page,
        source_meta: bboxPayload(layout, hit.line, "amount", hit.needle),
      };
    }
  }

  let best: { score: number; layout: PageLayout; line: PageLine; needle: string } | null = null;
  for (const layout of layoutOrder) {
    for (const dn of dates) {
      const dl = dn.toLowerCase();
      for (const line of expandedSearchLines(layout)) {
        if (!line.text.toLowerCase().includes(dl)) continue;
        const s = scoreLine(line, desc);
        const ranked = s > 0 ? s : 1;
        if (!best || ranked > best.score) best = { score: ranked, layout, line, needle: dn };
      }
    }
  }

  if (best) {
    return {
      page_number: best.layout.page,
      source_meta: bboxPayload(
        best.layout,
        best.line,
        best.score > 1 ? "date+desc" : "date",
        best.needle
      ),
    };
  }

  return { page_number: tx.page_hint ?? null, source_meta: null };
}
