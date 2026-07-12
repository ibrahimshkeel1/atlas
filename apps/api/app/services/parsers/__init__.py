from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from app.services.ai_extract import ExtractionResult
from app.services.pakistan_banks import detect_pakistan_bank
from app.services.parsers.base import ParseResult, make_tx
from app.services.parsers.hbl import HBLParser
from app.services.parsers.meezan import MeezanParser
from app.services.parsers.ubl import UBLParser

PARSERS = [MeezanParser(), HBLParser(), UBLParser()]

# Map registry display names → dedicated parser.name when they differ
_PARSER_NAME_BY_DETECTED = {
    "Meezan": "Meezan",
    "HBL": "HBL",
    "UBL": "UBL",
}


def detect_bank(text: str) -> Optional[str]:
    return detect_pakistan_bank(text)


def _generic_fallback(text: str) -> ParseResult:
    """Last-resort ISO/slash date rows when no bank parser matched."""
    pattern = re.compile(
        r"(?P<date>\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s+"
        r"(?P<desc>.+?)\s+"
        r"(?P<a>-?\d[\d,]*\.\d{2})\s+"
        r"(?P<b>-?\d[\d,]*\.\d{2})?(?:\s+(?P<c>-?\d[\d,]*\.\d{2}))?",
        re.IGNORECASE,
    )
    seen: set = set()
    txs = []
    for line in text.splitlines():
        line = line.strip()
        if len(line) < 10:
            continue
        m = pattern.search(line)
        if not m:
            continue
        raw_date = m.group("date").replace("/", "-")
        dt = None
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%m-%d-%Y", "%d-%m-%y", "%m-%d-%y"):
            try:
                dt = datetime.strptime(raw_date, fmt).date().isoformat()
                break
            except ValueError:
                continue
        if not dt:
            continue
        amounts = [x for x in [m.group("a"), m.group("b"), m.group("c")] if x]
        debit = credit = balance = None
        if len(amounts) == 1:
            debit = amounts[0]
        elif len(amounts) == 2:
            debit, balance = amounts[0], amounts[1]
        else:
            debit, credit, balance = amounts[0], amounts[1], amounts[2]
        tx = make_tx(dt, m.group("desc"), debit, credit, balance, 0.55, seen)
        if tx:
            txs.append(tx)
    return ParseResult(bank_name=detect_bank(text), transactions=txs)


def run_bank_parsers(document_text: str) -> ExtractionResult:
    """Prefer the detected bank's parser, then any parser that yields rows, then generic."""
    detected = detect_bank(document_text)
    parser_target = _PARSER_NAME_BY_DETECTED.get(detected or "", detected)

    ordered = list(PARSERS)
    if parser_target:
        ordered.sort(key=lambda p: 0 if p.name == parser_target else 1)

    for parser in ordered:
        if parser_target and parser.name != parser_target and not parser.detect(document_text):
            continue
        result = parser.parse(document_text)
        if result.transactions:
            return ExtractionResult(
                bank_name=result.bank_name or detected or parser.name,
                transactions=result.transactions,
            )

    for parser in PARSERS:
        result = parser.parse(document_text)
        if result.transactions:
            return ExtractionResult(
                bank_name=result.bank_name or detected or parser.name,
                transactions=result.transactions,
            )

    best = _generic_fallback(document_text)
    return ExtractionResult(
        bank_name=best.bank_name or detected,
        transactions=best.transactions,
    )


def parser_method_label(bank_name: Optional[str]) -> str:
    if not bank_name:
        return "heuristic"
    name = bank_name.lower()
    for parser in PARSERS:
        if parser.name.lower() == name:
            return f"parser:{parser.name.lower()}"
    return "heuristic"
