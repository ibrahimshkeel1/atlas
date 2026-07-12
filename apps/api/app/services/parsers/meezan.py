from __future__ import annotations

import re
from datetime import datetime

from app.services.parsers.base import ParseResult, make_tx


class MeezanParser:
    name = "Meezan"

    _money = r"(?:Rs\.?|PKR)\s*(?P<amt>\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{2})"
    _line = re.compile(
        r"(?P<date>\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})\s+"
        r"(?P<desc>.+?)"
        r"(?P<sign>[+\-])\s*" + _money +
        r"(?:\s+(?:Rs\.?|PKR)\s*(?P<balance>\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}))?",
        re.IGNORECASE,
    )

    def detect(self, text: str) -> bool:
        low = text.lower()
        return "meezan" in low or bool(
            re.search(r"\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}.+(?:rs\.?|pkr)", low)
        )

    def parse(self, text: str) -> ParseResult:
        seen: set = set()
        txs = []
        for line in text.splitlines():
            line = line.strip()
            if len(line) < 12 or not re.search(r"Rs\.?|PKR", line, re.I):
                continue
            m = self._line.search(line)
            if not m:
                continue
            try:
                dt = datetime.strptime(m.group("date"), "%d %b %Y").date().isoformat()
            except ValueError:
                continue
            amount = m.group("amt")
            balance = m.group("balance")
            sign = m.group("sign")
            debit = amount if sign == "-" else None
            credit = amount if sign == "+" else None
            desc = m.group("desc")
            desc = re.sub(
                r"[+\-]?\s*(?:Rs\.?|PKR)?\s*\d[\d,]*\.?\d{0,2}\s*$",
                "",
                desc,
                flags=re.I,
            )
            tx = make_tx(dt, desc, debit, credit, balance, 0.78, seen)
            if tx:
                txs.append(tx)
        return ParseResult(bank_name=self.name if txs else None, transactions=txs)
