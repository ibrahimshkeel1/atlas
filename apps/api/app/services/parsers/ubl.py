from __future__ import annotations

import re
from datetime import datetime

from app.services.parsers.base import ParseResult, make_tx


class UBLParser:
    """UBL-style rows: DD/MM/YYYY  description  DR/CR amount  balance."""

    name = "UBL"

    _line = re.compile(
        r"(?P<date>\d{1,2}/\d{1,2}/\d{4})\s+"
        r"(?P<desc>.+?)\s+"
        r"(?P<source>DR|CR)\s+"
        r"(?P<amt>\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})\s+"
        r"(?P<balance>-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?\d+\.\d{2})",
        re.IGNORECASE,
    )

    def detect(self, text: str) -> bool:
        low = text.lower()
        return "ubl" in low or "united bank" in low

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
            raw_date = m.group("date")
            try:
                dt = datetime.strptime(raw_date, "%d/%m/%Y").date().isoformat()
            except ValueError:
                continue
            amt = m.group("amt")
            src = m.group("source").upper()
            debit = amt if src == "DR" else None
            credit = amt if src == "CR" else None
            bal_raw = m.group("balance")
            balance = None if bal_raw.startswith("-") else bal_raw
            tx = make_tx(dt, m.group("desc"), debit, credit, balance, 0.8, seen)
            if tx:
                txs.append(tx)
        return ParseResult(bank_name=self.name if txs else None, transactions=txs)
