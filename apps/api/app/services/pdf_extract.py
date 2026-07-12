from __future__ import annotations

import io
import re
from typing import Any, Optional


def extract_text_from_pdf(pdf_bytes: bytes) -> tuple[str, int, bool]:
    """
    Returns (text, page_count, used_ocr).
    Tries pdfplumber first; falls back to OCR if text is too sparse.
    """
    pages, used_ocr = extract_pdf_pages(pdf_bytes)
    joined = "\n\n".join(text for _, text in pages).strip()
    return joined, len(pages), used_ocr


def extract_pdf_pages(pdf_bytes: bytes) -> tuple[list[tuple[int, str]], bool]:
    """
    Returns ([(page_number_1based, text), ...], used_ocr).
    """
    import pdfplumber

    pages_text: list[str] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            pages_text.append(page.extract_text() or "")

    joined = "\n\n".join(pages_text).strip()
    if len(joined) >= 80:
        return [(i + 1, t) for i, t in enumerate(pages_text)], False

    ocr_pages = _ocr_pdf_pages(pdf_bytes)
    if any(t.strip() for t in ocr_pages):
        if len(ocr_pages) >= len(pages_text):
            return [(i + 1, t) for i, t in enumerate(ocr_pages)], True
        return [(i + 1, t) for i, t in enumerate(ocr_pages)], True

    return [(i + 1, t) for i, t in enumerate(pages_text)], False


def extract_page_layouts(pdf_bytes: bytes) -> list[dict[str, Any]]:
    """
    Word-level layout per page for highlight boxes.
    Returns [] if pdfplumber can't extract positioned words (e.g. scans).
    """
    import pdfplumber

    layouts: list[dict[str, Any]] = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for i, page in enumerate(pdf.pages):
                words_raw = page.extract_words(
                    keep_blank_chars=False,
                    use_text_flow=True,
                    extra_attrs=["size"],
                ) or []
                words = []
                for w in words_raw:
                    text = (w.get("text") or "").strip()
                    if not text:
                        continue
                    words.append(
                        {
                            "text": text,
                            "x0": float(w["x0"]),
                            "top": float(w["top"]),
                            "x1": float(w["x1"]),
                            "bottom": float(w["bottom"]),
                        }
                    )
                layouts.append(
                    {
                        "page": i + 1,
                        "width": float(page.width),
                        "height": float(page.height),
                        "words": words,
                    }
                )
    except Exception:
        return []
    return layouts


def _normalize_tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", text.lower()) if t]


def _date_needles(transaction_date: str) -> list[str]:
    if not transaction_date or len(transaction_date) < 10:
        return []
    try:
        from datetime import date as date_cls

        d = date_cls.fromisoformat(transaction_date[:10])
        return [
            d.strftime("%d %b %Y").lower(),
            d.strftime("%d/%m/%Y"),
            d.strftime("%d-%m-%Y"),
            d.isoformat(),
            d.strftime("%d %B %Y").lower(),
        ]
    except ValueError:
        return []


def _merge_word_bbox(words: list[dict[str, Any]]) -> dict[str, float]:
    return {
        "x0": min(w["x0"] for w in words),
        "top": min(w["top"] for w in words),
        "x1": max(w["x1"] for w in words),
        "bottom": max(w["bottom"] for w in words),
    }


def _expand_to_line(
    layout: dict[str, Any], seed: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Include other words on roughly the same baseline (transaction row)."""
    if not seed:
        return seed
    mid_y = (min(w["top"] for w in seed) + max(w["bottom"] for w in seed)) / 2
    tol = max(3.0, (max(w["bottom"] for w in seed) - min(w["top"] for w in seed)) * 0.6)
    line = [
        w
        for w in layout["words"]
        if abs(((w["top"] + w["bottom"]) / 2) - mid_y) <= tol
    ]
    return sorted(line, key=lambda w: w["x0"]) if line else seed


def _bbox_payload(
    layout: dict[str, Any], words: list[dict[str, Any]], *, match: str, needle: str
) -> dict[str, Any]:
    box = _merge_word_bbox(words)
    width = layout["width"] or 1.0
    height = layout["height"] or 1.0
    # Pad slightly so the highlight is readable
    pad_x = 2.0
    pad_y = 1.5
    x0 = max(0.0, box["x0"] - pad_x)
    top = max(0.0, box["top"] - pad_y)
    x1 = min(width, box["x1"] + pad_x)
    bottom = min(height, box["bottom"] + pad_y)
    return {
        "match": match,
        "needle": needle[:64],
        "bbox": {"x0": x0, "top": top, "x1": x1, "bottom": bottom},
        "bbox_norm": {
            "x": x0 / width,
            "y": top / height,
            "w": max((x1 - x0) / width, 0.01),
            "h": max((bottom - top) / height, 0.008),
        },
        "page_width": width,
        "page_height": height,
    }


def find_words_for_needle(
    layout: dict[str, Any], needle: str
) -> Optional[list[dict[str, Any]]]:
    """Find a contiguous word span whose text contains the needle."""
    needle = (needle or "").strip().lower()
    if len(needle) < 3:
        return None
    words = layout.get("words") or []
    if not words:
        return None

    tokens = _normalize_tokens(needle)
    word_tokens = [_normalize_tokens(w["text"]) for w in words]
    flat: list[tuple[int, str]] = []
    for i, toks in enumerate(word_tokens):
        for t in toks:
            flat.append((i, t))

    def span_from_flat(start: int, length: int) -> list[dict[str, Any]]:
        i0 = flat[start][0]
        i1 = flat[start + length - 1][0]
        return words[i0 : i1 + 1]

    if tokens:
        n = len(tokens)
        for start in range(0, max(0, len(flat) - n + 1)):
            if all(flat[start + j][1] == tokens[j] for j in range(n)):
                return span_from_flat(start, n)

        content = [t for t in tokens if len(t) >= 3]
        for soft in (
            content[: min(3, len(content))],
            content[-min(3, len(content)) :],
        ):
            if len(soft) < 2:
                continue
            m = len(soft)
            for start in range(0, max(0, len(flat) - m + 1)):
                if all(flat[start + j][1] == soft[j] for j in range(m)):
                    return span_from_flat(start, m)

        # Distinctive merchant/brand token (longest first)
        for tok in sorted({t for t in tokens if len(t) >= 5}, key=len, reverse=True):
            for start, (_, t) in enumerate(flat):
                if t == tok:
                    return span_from_flat(start, 1)

    stream = ""
    index_map: list[int] = []
    for i, w in enumerate(words):
        if stream:
            stream += " "
            index_map.append(i)
        for _ in w["text"].lower():
            index_map.append(i)
        stream += w["text"].lower()
    pos = stream.find(needle)
    if pos >= 0 and index_map:
        start_i = index_map[pos]
        end_i = index_map[min(pos + len(needle) - 1, len(index_map) - 1)]
        return words[start_i : end_i + 1]

    return None


def _score_line_for_description(line_words: list[dict[str, Any]], description: str) -> int:
    desc_tokens = set(t for t in _normalize_tokens(description) if len(t) >= 3)
    if not desc_tokens:
        return 0
    line_tokens = set()
    for w in line_words:
        line_tokens.update(_normalize_tokens(w["text"]))
    return len(desc_tokens & line_tokens)


def attach_bbox_meta(
    layouts: list[dict[str, Any]],
    *,
    page_number: Optional[int],
    description: str,
    transaction_date: str,
    base_meta: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Enrich source_meta with a highlight bbox when layouts are available."""
    meta: dict[str, Any] = dict(base_meta or {})
    if not layouts or not page_number:
        return meta

    layout = next((L for L in layouts if L["page"] == page_number), None)
    if not layout or not layout.get("words"):
        return meta

    desc = (description or "").strip()
    candidates: list[tuple[str, str]] = []
    if len(desc) >= 6:
        candidates.append(("description", desc[:64]))
        candidates.append(("description", desc[:40]))
        candidates.append(("description", desc[:24]))

    for match_kind, needle in candidates:
        hit = find_words_for_needle(layout, needle)
        if not hit:
            continue
        span = _expand_to_line(layout, hit)
        meta.update(_bbox_payload(layout, span, match=match_kind, needle=needle))
        return meta

    # Date fallback: pick the date-row whose line best overlaps the description
    # (avoids highlighting the first same-day transaction every time).
    best: Optional[tuple[int, list[dict[str, Any]], str]] = None
    for dn in _date_needles(transaction_date):
        # Find every occurrence of this date needle
        words = layout["words"]
        tokens_dn = _normalize_tokens(dn)
        if not tokens_dn:
            continue
        flat: list[tuple[int, str]] = []
        for i, w in enumerate(words):
            for t in _normalize_tokens(w["text"]):
                flat.append((i, t))
        m = len(tokens_dn)
        for start in range(0, max(0, len(flat) - m + 1)):
            if all(flat[start + j][1] == tokens_dn[j] for j in range(m)):
                seed = words[flat[start][0] : flat[start + m - 1][0] + 1]
                line = _expand_to_line(layout, seed)
                score = _score_line_for_description(line, desc)
                if best is None or score > best[0]:
                    best = (score, line, dn)

    if best and best[0] > 0:
        meta.update(
            _bbox_payload(layout, best[1], match="date+desc", needle=best[2])
        )
        return meta
    if best:
        meta.update(_bbox_payload(layout, best[1], match="date", needle=best[2]))
        return meta

    return meta


def find_source_page(
    *,
    description: str,
    transaction_date: str,
    pages: list[tuple[int, str]],
    layouts: Optional[list[dict[str, Any]]] = None,
) -> tuple[Optional[int], dict]:
    """Best-effort map a transaction back to a PDF page (+ bbox when possible)."""
    if not pages:
        return None, {"match": None}

    desc = (description or "").strip().lower()
    needles = [n for n in (desc[:48], desc[:24]) if len(n) >= 6]
    date_needles = _date_needles(transaction_date)

    page_num: Optional[int] = None
    meta: dict[str, Any] = {"match": None}

    for num, text in pages:
        low = text.lower()
        for needle in needles:
            if needle and needle in low:
                page_num, meta = num, {"match": "description", "needle": needle[:48]}
                break
        if page_num:
            break
        for needle in date_needles:
            if needle and needle in low and (not needles or any(n[:12] in low for n in needles)):
                page_num, meta = num, {"match": "date+desc", "needle": needle}
                break
        if page_num:
            break

    if page_num is None:
        for num, text in pages:
            low = text.lower()
            for needle in date_needles:
                if needle and needle in low:
                    page_num, meta = num, {"match": "date", "needle": needle}
                    break
            if page_num:
                break

    if page_num is not None and layouts:
        meta = attach_bbox_meta(
            layouts,
            page_number=page_num,
            description=description,
            transaction_date=transaction_date,
            base_meta=meta,
        )

    return page_num, meta


def _ocr_pdf_pages(pdf_bytes: bytes) -> list[str]:
    try:
        from pdf2image import convert_from_bytes
        import pytesseract
    except Exception:
        return []

    try:
        images = convert_from_bytes(pdf_bytes, dpi=200)
    except Exception:
        return []

    chunks: list[str] = []
    for img in images:
        try:
            chunks.append(pytesseract.image_to_string(img) or "")
        except Exception:
            chunks.append("")
    return chunks
