from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any, Optional


_MONEY = r"(?P<amt>-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|-?\d+\.\d{2})"


def _to_decimal(raw: str) -> Optional[Decimal]:
    try:
        return Decimal(raw.replace(",", "").strip())
    except (InvalidOperation, AttributeError, ValueError):
        return None


def extract_stated_closing_balance(text: str) -> Optional[Decimal]:
    """Best-effort closing balance from statement text (not a full reconciler)."""
    patterns = [
        rf"(?:closing|ending|available)\s+balance\s*[:.]?\s*(?:Rs\.?|PKR)?\s*{_MONEY}",
        rf"(?:balance\s+c/?f|balance\s+carried\s+forward)\s*[:.]?\s*(?:Rs\.?|PKR)?\s*{_MONEY}",
    ]
    matches: list[Decimal] = []
    for pat in patterns:
        for m in re.finditer(pat, text, flags=re.IGNORECASE):
            val = _to_decimal(m.group("amt"))
            if val is not None:
                matches.append(val)
    if not matches:
        return None
    return matches[-1]


def tie_out_balances(
    stated: Optional[Decimal],
    ledger: Optional[Decimal],
    tolerance: Decimal = Decimal("0.02"),
) -> dict[str, Any]:
    if stated is None or ledger is None:
        return {
            "stated_closing": float(stated) if stated is not None else None,
            "ledger_closing": float(ledger) if ledger is not None else None,
            "tie_out": "unknown",
            "difference": None,
        }
    diff = (stated - ledger).copy_abs()
    ok = diff <= tolerance
    return {
        "stated_closing": float(stated),
        "ledger_closing": float(ledger),
        "tie_out": "match" if ok else "mismatch",
        "difference": float(diff),
    }
