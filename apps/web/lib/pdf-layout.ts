import "server-only";

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

export function attachSourceMeta(
  layouts: PageLayout[],
  tx: { transaction_date: string; description: string }
): { page_number: number | null; source_meta: Record<string, unknown> | null } {
  const desc = tx.description.trim();
  const needles = [desc, desc.slice(0, 48), desc.slice(0, 32), desc.slice(0, 24)].filter(
    (n, i, arr) => n.length >= 6 && arr.indexOf(n) === i
  );
  const dates = dateNeedles(tx.transaction_date);

  for (const layout of layouts) {
    for (const needle of needles) {
      const low = needle.toLowerCase();
      const hit = layout.lines.find((line) => line.text.toLowerCase().includes(low));
      if (hit) {
        return {
          page_number: layout.page,
          source_meta: bboxPayload(layout, hit, "description", needle),
        };
      }
    }
  }

  let best: { score: number; layout: PageLayout; line: PageLine; needle: string } | null = null;
  for (const layout of layouts) {
    for (const dn of dates) {
      const dl = dn.toLowerCase();
      for (const line of layout.lines) {
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

  return { page_number: null, source_meta: null };
}
