"""Pakistan banking system registry (scheduled + common microfinance / digital).

Source of scheduled commercial banks: State Bank of Pakistan ECIB member list.
Dedicated statement parsers exist only where marked parser_status=supported;
others are detection/catalog only until labeled fixtures exist.
"""

from __future__ import annotations

import re
from typing import Any, Optional

# Longest aliases first is applied at runtime in detect helpers.
# slug: stable id for fixtures / APIs
# name: display / document.bank_name
# aliases: lowercase substrings matched in statement text
# category: scheduled | islamic | foreign | specialized | microfinance | digital
# parser_status: supported | planned

PAKISTAN_BANKS: list[dict[str, Any]] = [
    # --- Dedicated parsers today ---
    {
        "slug": "meezan",
        "name": "Meezan",
        "legal_name": "Meezan Bank Limited",
        "category": "islamic",
        "parser_status": "supported",
        "aliases": ["meezan bank", "meezan"],
    },
    {
        "slug": "hbl",
        "name": "HBL",
        "legal_name": "Habib Bank Limited",
        "category": "scheduled",
        "parser_status": "supported",
        "aliases": ["habib bank limited", "habib bank", "hbl"],
    },
    {
        "slug": "ubl",
        "name": "UBL",
        "legal_name": "United Bank Limited",
        "category": "scheduled",
        "parser_status": "supported",
        "aliases": ["united bank limited", "united bank", "ubl"],
    },
    # --- Scheduled / Islamic / foreign (detection only) ---
    {
        "slug": "nbp",
        "name": "NBP",
        "legal_name": "National Bank of Pakistan",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["national bank of pakistan", "national bank", "nbp"],
    },
    {
        "slug": "mcb",
        "name": "MCB",
        "legal_name": "MCB Bank Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["mcb bank", "muslim commercial bank"],
    },
    {
        "slug": "mcb-islamic",
        "name": "MCB Islamic",
        "legal_name": "MCB Islamic Bank Limited",
        "category": "islamic",
        "parser_status": "planned",
        "aliases": ["mcb islamic bank", "mcb islamic"],
    },
    {
        "slug": "abl",
        "name": "Allied Bank",
        "legal_name": "Allied Bank Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["allied bank limited", "allied bank", "abl"],
    },
    {
        "slug": "alfalah",
        "name": "Bank Alfalah",
        "legal_name": "Bank Alfalah Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["bank alfalah", "alfalah"],
    },
    {
        "slug": "bah",
        "name": "Bank AL Habib",
        "legal_name": "Bank AL Habib Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["bank al habib", "bank al-habib", "al habib", "bahl"],
    },
    {
        "slug": "askari",
        "name": "Askari Bank",
        "legal_name": "Askari Bank Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["askari bank", "askari"],
    },
    {
        "slug": "faysal",
        "name": "Faysal Bank",
        "legal_name": "Faysal Bank Limited",
        "category": "islamic",
        "parser_status": "planned",
        "aliases": ["faysal bank", "faysal"],
    },
    {
        "slug": "hmb",
        "name": "HabibMetro",
        "legal_name": "Habib Metropolitan Bank Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": [
            "habib metropolitan bank",
            "habib metropolitan",
            "habibmetro",
            "habib metro",
            "hmb",
        ],
    },
    {
        "slug": "scb",
        "name": "Standard Chartered",
        "legal_name": "Standard Chartered Bank (Pakistan) Limited",
        "category": "foreign",
        "parser_status": "planned",
        "aliases": ["standard chartered bank", "standard chartered", "scb pakistan"],
    },
    {
        "slug": "bop",
        "name": "Bank of Punjab",
        "legal_name": "The Bank of Punjab",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["bank of punjab", "the bank of punjab", "bop"],
    },
    {
        "slug": "bok",
        "name": "Bank of Khyber",
        "legal_name": "The Bank of Khyber",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["bank of khyber", "the bank of khyber", "bok"],
    },
    {
        "slug": "bankislami",
        "name": "BankIslami",
        "legal_name": "BankIslami Pakistan Limited",
        "category": "islamic",
        "parser_status": "planned",
        "aliases": ["bankislami pakistan", "bank islami", "bankislami"],
    },
    {
        "slug": "dib",
        "name": "Dubai Islamic",
        "legal_name": "Dubai Islamic Bank Pakistan Limited",
        "category": "islamic",
        "parser_status": "planned",
        "aliases": ["dubai islamic bank", "dubai islamic", "dib pakistan"],
    },
    {
        "slug": "albaraka",
        "name": "Al Baraka",
        "legal_name": "Al Baraka Bank (Pakistan) Limited",
        "category": "islamic",
        "parser_status": "planned",
        "aliases": ["al baraka bank", "albaraka", "al baraka"],
    },
    {
        "slug": "js",
        "name": "JS Bank",
        "legal_name": "JS Bank Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["js bank", "jahangir siddiqui bank"],
    },
    {
        "slug": "soneri",
        "name": "Soneri Bank",
        "legal_name": "Soneri Bank Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["soneri bank", "soneri"],
    },
    {
        "slug": "silk",
        "name": "Silkbank",
        "legal_name": "Silk Bank Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["silk bank", "silkbank"],
    },
    {
        "slug": "samba",
        "name": "Samba Bank",
        "legal_name": "Samba Bank Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["samba bank", "samba"],
    },
    {
        "slug": "sindh",
        "name": "Sindh Bank",
        "legal_name": "Sindh Bank Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["sindh bank"],
    },
    {
        "slug": "makramah",
        "name": "Bank Makramah",
        "legal_name": "Bank Makramah Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["bank makramah", "makramah", "summit bank"],
    },
    {
        "slug": "fwbl",
        "name": "First Women Bank",
        "legal_name": "First Women Bank Limited",
        "category": "scheduled",
        "parser_status": "planned",
        "aliases": ["first women bank", "fwbl"],
    },
    {
        "slug": "ztbl",
        "name": "ZTBL",
        "legal_name": "Zarai Taraqiati Bank Limited",
        "category": "specialized",
        "parser_status": "planned",
        "aliases": ["zarai taraqiati", "ztbl", "agricultural development bank"],
    },
    {
        "slug": "sme",
        "name": "SME Bank",
        "legal_name": "S.M.E. Bank Limited",
        "category": "specialized",
        "parser_status": "planned",
        "aliases": ["s.m.e. bank", "sme bank"],
    },
    {
        "slug": "ppcb",
        "name": "Punjab Provincial Cooperative",
        "legal_name": "The Punjab Provincial Cooperative Bank Limited",
        "category": "specialized",
        "parser_status": "planned",
        "aliases": ["punjab provincial cooperative", "ppcb"],
    },
    {
        "slug": "idbp",
        "name": "IDBP",
        "legal_name": "Industrial Development Bank of Pakistan",
        "category": "specialized",
        "parser_status": "planned",
        "aliases": ["industrial development bank of pakistan", "idbp"],
    },
    {
        "slug": "citi",
        "name": "Citibank",
        "legal_name": "Citibank N.A. Pakistan",
        "category": "foreign",
        "parser_status": "planned",
        "aliases": ["citibank", "citi bank"],
    },
    {
        "slug": "deutsche",
        "name": "Deutsche Bank",
        "legal_name": "Deutsche Bank A.G.",
        "category": "foreign",
        "parser_status": "planned",
        "aliases": ["deutsche bank"],
    },
    {
        "slug": "icbc",
        "name": "ICBC",
        "legal_name": "Industrial and Commercial Bank of China",
        "category": "foreign",
        "parser_status": "planned",
        "aliases": [
            "industrial and commercial bank of china",
            "icbc pakistan",
            "icbc",
        ],
    },
    {
        "slug": "boc",
        "name": "Bank of China",
        "legal_name": "Bank of China Limited Pakistan Operations",
        "category": "foreign",
        "parser_status": "planned",
        "aliases": ["bank of china"],
    },
    # --- Microfinance ---
    {
        "slug": "khushhali",
        "name": "Khushhali",
        "legal_name": "Khushhali Microfinance Bank Limited",
        "category": "microfinance",
        "parser_status": "planned",
        "aliases": ["khushhali microfinance", "khushhali bank", "khushhali"],
    },
    {
        "slug": "telenor-mf",
        "name": "Telenor Microfinance",
        "legal_name": "Telenor Microfinance Bank Limited",
        "category": "microfinance",
        "parser_status": "planned",
        "aliases": ["telenor microfinance bank", "telenor microfinance"],
    },
    {
        "slug": "mobilink-mf",
        "name": "Mobilink Microfinance",
        "legal_name": "Mobilink Microfinance Bank Limited",
        "category": "microfinance",
        "parser_status": "planned",
        "aliases": ["mobilink microfinance", "jazz microfinance"],
    },
    {
        "slug": "u-bank",
        "name": "U Microfinance Bank",
        "legal_name": "U Microfinance Bank Limited",
        "category": "microfinance",
        "parser_status": "planned",
        "aliases": ["u microfinance bank", "u bank"],
    },
    {
        "slug": "nrsp",
        "name": "NRSP Microfinance",
        "legal_name": "NRSP Microfinance Bank Limited",
        "category": "microfinance",
        "parser_status": "planned",
        "aliases": ["nrsp microfinance", "nrsp bank"],
    },
    {
        "slug": "finca",
        "name": "FINCA",
        "legal_name": "FINCA Microfinance Bank Limited",
        "category": "microfinance",
        "parser_status": "planned",
        "aliases": ["finca microfinance", "finca bank", "finca"],
    },
    {
        "slug": "apna",
        "name": "Apna Microfinance",
        "legal_name": "Apna Microfinance Bank Limited",
        "category": "microfinance",
        "parser_status": "planned",
        "aliases": ["apna microfinance", "apna bank"],
    },
    {
        "slug": "advans",
        "name": "Advans Pakistan",
        "legal_name": "Advans Pakistan Microfinance Bank Limited",
        "category": "microfinance",
        "parser_status": "planned",
        "aliases": ["advans pakistan", "advans"],
    },
    {
        "slug": "hbl-mf",
        "name": "HBL Microfinance",
        "legal_name": "HBL Microfinance Bank Limited",
        "category": "microfinance",
        "parser_status": "planned",
        "aliases": ["hbl microfinance"],
    },
    # --- Digital / EMI style (often appear on statements) ---
    {
        "slug": "easypaisa",
        "name": "EasyPaisa",
        "legal_name": "EasyPaisa (Telenor Microfinance Bank)",
        "category": "digital",
        "parser_status": "planned",
        "aliases": ["easypaisa", "easy paisa"],
    },
    {
        "slug": "jazzcash",
        "name": "JazzCash",
        "legal_name": "JazzCash (Mobilink Microfinance Bank)",
        "category": "digital",
        "parser_status": "planned",
        "aliases": ["jazzcash", "jazz cash"],
    },
    {
        "slug": "nayapay",
        "name": "NayaPay",
        "legal_name": "NayaPay",
        "category": "digital",
        "parser_status": "planned",
        "aliases": ["nayapay", "naya pay"],
    },
    {
        "slug": "sadapay",
        "name": "SadaPay",
        "legal_name": "SadaPay",
        "category": "digital",
        "parser_status": "planned",
        "aliases": ["sadapay", "sada pay"],
    },
]


def _alias_index() -> list[tuple[str, str]]:
    """(alias, display_name) sorted longest-first to avoid short false matches."""
    pairs: list[tuple[str, str]] = []
    for bank in PAKISTAN_BANKS:
        for alias in bank["aliases"]:
            pairs.append((alias.lower(), bank["name"]))
    pairs.sort(key=lambda x: len(x[0]), reverse=True)
    return pairs


_ALIAS_INDEX = _alias_index()


def detect_pakistan_bank(text: str) -> Optional[str]:
    """Return canonical display name if a known Pakistan bank token appears in text."""
    low = text.lower()
    for alias, name in _ALIAS_INDEX:
        if len(alias) <= 3:
            # Short codes (HBL, UBL, ABL) — require word-ish boundaries
            if re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", low):
                return name
        elif alias in low:
            return name
    return None


def bank_by_slug(slug: str) -> Optional[dict[str, Any]]:
    for bank in PAKISTAN_BANKS:
        if bank["slug"] == slug:
            return bank
    return None


def bank_by_name(name: str) -> Optional[dict[str, Any]]:
    low = name.lower().strip()
    for bank in PAKISTAN_BANKS:
        if bank["name"].lower() == low or bank["slug"] == low:
            return bank
        if bank["legal_name"].lower() == low:
            return bank
    return None


def list_pakistan_banks() -> list[dict[str, Any]]:
    """API-friendly catalog (no internal-only fields beyond aliases)."""
    return [
        {
            "slug": b["slug"],
            "name": b["name"],
            "legal_name": b["legal_name"],
            "category": b["category"],
            "parser_status": b["parser_status"],
            "aliases": list(b["aliases"]),
        }
        for b in PAKISTAN_BANKS
    ]


def pakistan_banks_summary() -> dict[str, Any]:
    banks = list_pakistan_banks()
    by_status: dict[str, int] = {}
    by_category: dict[str, int] = {}
    for b in banks:
        by_status[b["parser_status"]] = by_status.get(b["parser_status"], 0) + 1
        by_category[b["category"]] = by_category.get(b["category"], 0) + 1
    return {
        "country": "PK",
        "currency": "PKR",
        "total": len(banks),
        "by_parser_status": by_status,
        "by_category": by_category,
        "banks": banks,
        "source_note": (
            "Scheduled banks aligned with SBP ECIB members; "
            "microfinance and digital wallets included for statement detection. "
            "Dedicated parsers only where parser_status=supported."
        ),
    }
