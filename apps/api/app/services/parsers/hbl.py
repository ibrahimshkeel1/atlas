from __future__ import annotations

import re
from datetime import datetime

from app.services.parsers.base import ParseResult, make_tx


class HBLParser:
    """HBL-style rows: YYYY-MM-DD desc debit credit balance (or debit/credit as 0.00)."""

    name = "HBL"

    _line = re.compile(
        r"(?P<date>\d{4}-\d{2}-\d{2})\s+"
        r"(?P<desc>.+?)\s+"
        r"(?P<debit>\d[\d,]*\.\d{2})\s+"
        r"(?P<credit>\d[\d,]*\.\d{2})\s+"
        r"(?P<balance>\d[\d,]*\.\d{2})",
        re.IGNORECASE,
    )

    def detect(self, text: str) -> bool:
        low = text.lower()
        return "hbl" in low or "habib bank" in low

    def parse(self, text: str) -> ParseResult:
        seen: set = set()
        txs = []
        for line in text.splitlines():
            line = line.strip()
            if len(line) < 16:
                continue
            m = self._line.search(line)
            if not m:
                continue
            try:
                dt = datetime.strptime(m.group("date"), "%Y-%m-%d").date().isoformat()
            except ValueError:
                continue
            tx = make_tx(
                dt,
                m.group("desc"),
                m.group("debit"),
                m.group("credit"),
                m.group("balance"),
                0.8,
                seen,
            )
            if tx:
                txs.append(tx)
        return ParseResult(bank_name=self.name if txs else None, transactions=txs)
