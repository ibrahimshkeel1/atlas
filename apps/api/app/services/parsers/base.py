from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional, Protocol

from app.services.ai_extract import ExtractedTransaction

MAX_AMOUNT = 50_000_000


@dataclass
class ParseResult:
    bank_name: Optional[str]
    transactions: list[ExtractedTransaction]


def normalize_money(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    cleaned = raw.replace(",", "").replace(" ", "").strip()
    if not cleaned:
        return None
    if "." not in cleaned:
        cleaned = f"{cleaned}.00"
    try:
        value = float(cleaned)
    except ValueError:
        return None
    if value < 0 or value > MAX_AMOUNT:
        return None
    return f"{value:.2f}"


def guess_category(desc: str, has_credit: bool) -> str:
    low = desc.lower()
    if any(w in low for w in ("salary", "payroll")):
        return "salaries"
    if any(w in low for w in ("fuel", "shell", "pso", "petrol")):
        return "fuel"
    if "rent" in low:
        return "rent"
    if any(w in low for w in ("tax", "fbr", "withholding")):
        return "taxes"
    if any(w in low for w in ("utility", "k-electric", "ke ", "ssgc", "sui", "kesc")):
        return "utilities"
    if any(w in low for w in ("marketing", "facebook", "ads", "google ads")):
        return "marketing"
    if any(w in low for w in ("purchase", "inventory", "supplier")):
        return "purchases"
    if any(w in low for w in ("sale", "pos", "customer", "received", "remittance", "payment")):
        return "customer-payments" if has_credit else "sales"
    if has_credit and any(w in low for w in ("loan", "disburs")):
        return "loan"
    if has_credit:
        return "customer-payments"
    return "other"


def clean_description(desc: str) -> str:
    desc = re.sub(r"\+?\d{10,}", " ", desc)
    desc = re.sub(r"\s+", " ", desc).strip(" -|")
    return desc[:500]


def make_tx(
    dt: str,
    desc: str,
    debit: Optional[str],
    credit: Optional[str],
    balance: Optional[str],
    confidence: float,
    seen: set,
    page_number: Optional[int] = None,
    extraction_source: Optional[str] = None,
) -> Optional[ExtractedTransaction]:
    debit = normalize_money(debit)
    credit = normalize_money(credit)
    balance = normalize_money(balance)
    desc = clean_description(desc)
    if len(desc) < 3:
        return None
    if debit is None and credit is None:
        return None
    # Treat 0.00 as empty for debit/credit columns
    if debit == "0.00":
        debit = None
    if credit == "0.00":
        credit = None
    if debit is None and credit is None:
        return None
    key = (dt, desc.lower()[:80], debit, credit)
    if key in seen:
        return None
    seen.add(key)
    return ExtractedTransaction(
        transaction_date=dt,
        description=desc,
        debit=debit,
        credit=credit,
        balance=balance,
        reference=None,
        category=guess_category(desc, credit is not None),
        confidence_score=confidence,
        page_number=page_number,
        extraction_source=extraction_source,
    )


class BankParser(Protocol):
    name: str

    def detect(self, text: str) -> bool:
        ...

    def parse(self, text: str) -> ParseResult:
        ...
