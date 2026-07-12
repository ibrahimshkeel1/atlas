"""Bank statement parser evaluation framework.

Discovers fixtures under sample-data/bank-eval/{public,private}/ and scores:
  - row recall
  - date accuracy
  - debit/credit accuracy
  - amount accuracy
  - balance reconciliation

Never invents metrics — empty fixture set yields empty reports.
Private fixtures are opt-in and must not be committed.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

from app.services.parsers import run_bank_parsers
from app.services.statement_balance import extract_stated_closing_balance, tie_out_balances

BANKS = ("meezan", "hbl", "ubl")
BANK_LABEL = {"meezan": "Meezan", "hbl": "HBL", "ubl": "UBL"}


def _repo_root() -> Path:
    # apps/api/app/services/bank_parser_eval.py → parents[4] = monorepo root
    here = Path(__file__).resolve()
    for parent in [here.parents[4], here.parents[3], Path.cwd(), Path.cwd().parent]:
        if (parent / "sample-data" / "bank-eval").exists():
            return parent
        if (parent / "sample-data" / "fixtures").exists():
            return parent
    return here.parents[4]


def bank_eval_root() -> Path:
    return _repo_root() / "sample-data" / "bank-eval"


def _norm_money(v: Any) -> Optional[str]:
    if v is None or v == "":
        return None
    s = str(v).replace(",", "").strip()
    try:
        return f"{float(s):.2f}"
    except ValueError:
        return None


def _amount_pair(tx: dict) -> tuple[Optional[str], Optional[str]]:
    return _norm_money(tx.get("debit")), _norm_money(tx.get("credit"))


def _side(tx: dict) -> Optional[str]:
    d, c = _amount_pair(tx)
    if d is not None and c is None:
        return "debit"
    if c is not None and d is None:
        return "credit"
    if d is not None and c is not None:
        return "both"
    return None


def _tx_key(tx: dict) -> tuple:
    return (
        tx.get("transaction_date"),
        _norm_money(tx.get("debit")),
        _norm_money(tx.get("credit")),
    )


def _last_balance(rows: list[dict]) -> Optional[float]:
    for tx in reversed(rows):
        bal = _norm_money(tx.get("balance"))
        if bal is not None:
            return float(bal)
    return None


def _pred_rows(predicted: Any) -> tuple[list[dict], Optional[str]]:
    if hasattr(predicted, "transactions"):
        rows = [
            {
                "transaction_date": t.transaction_date,
                "description": t.description,
                "debit": t.debit,
                "credit": t.credit,
                "balance": t.balance,
            }
            for t in predicted.transactions
        ]
        return rows, predicted.bank_name
    return list(predicted.get("transactions") or []), predicted.get("bank_name")


def _load_statement_text(folder: Path) -> tuple[str, str]:
    """Return (text, source_label). Prefer PDF extract when PDF present; else statement.txt."""
    pdf = folder / "statement.pdf"
    txt = folder / "statement.txt"
    if pdf.exists():
        try:
            from app.services.pdf_extract import extract_text_from_pdf

            text, _pages, _ocr = extract_text_from_pdf(pdf.read_bytes())
            if text and len(text.strip()) >= 40:
                return text, "pdf"
        except Exception:  # noqa: BLE001 — fall back to txt for eval
            pass
    if txt.exists():
        return txt.read_text(encoding="utf-8", errors="replace"), "txt"
    if pdf.exists():
        raise FileNotFoundError(f"{folder}: PDF extract failed and no statement.txt")
    raise FileNotFoundError(f"{folder}: need statement.pdf or statement.txt")


@dataclass
class FixtureRef:
    bank: str
    statement_id: str
    privacy: str
    path: Path


def discover_fixtures(
    *,
    include_private: bool = False,
    banks: Optional[list[str]] = None,
) -> list[FixtureRef]:
    root = bank_eval_root()
    wanted = {b.lower() for b in (banks or list(BANKS))}
    found: list[FixtureRef] = []

    scopes = ["public"]
    if include_private:
        scopes.append("private")

    for scope in scopes:
        base = root / scope
        if not base.exists():
            continue
        for bank_dir in sorted(base.iterdir()):
            if not bank_dir.is_dir():
                continue
            bank = bank_dir.name.lower()
            if bank not in BANKS or bank not in wanted:
                continue
            for stmt_dir in sorted(bank_dir.iterdir()):
                if not stmt_dir.is_dir():
                    continue
                if not (stmt_dir / "expected.json").exists():
                    continue
                if not (
                    (stmt_dir / "statement.pdf").exists()
                    or (stmt_dir / "statement.txt").exists()
                ):
                    continue
                privacy = scope
                meta_path = stmt_dir / "meta.json"
                if meta_path.exists():
                    try:
                        meta = json.loads(meta_path.read_text())
                        privacy = meta.get("privacy") or scope
                    except json.JSONDecodeError:
                        pass
                if privacy == "private" and not include_private:
                    continue
                found.append(
                    FixtureRef(
                        bank=bank,
                        statement_id=stmt_dir.name,
                        privacy=privacy,
                        path=stmt_dir,
                    )
                )

    # Optional external private dir (outside repo)
    if include_private:
        extra = os.environ.get("ATLAS_BANK_EVAL_PRIVATE_DIR")
        if extra:
            extra_path = Path(extra).expanduser()
            if extra_path.exists():
                for bank_dir in sorted(extra_path.iterdir()):
                    if not bank_dir.is_dir():
                        continue
                    bank = bank_dir.name.lower()
                    if bank not in BANKS or bank not in wanted:
                        continue
                    for stmt_dir in sorted(bank_dir.iterdir()):
                        if not stmt_dir.is_dir():
                            continue
                        if not (stmt_dir / "expected.json").exists():
                            continue
                        found.append(
                            FixtureRef(
                                bank=bank,
                                statement_id=stmt_dir.name,
                                privacy="private",
                                path=stmt_dir,
                            )
                        )

    # Legacy fallback: sample-data/fixtures/{bank}/ if bank-eval public empty for that bank
    legacy = _repo_root() / "sample-data" / "fixtures"
    if legacy.exists():
        have = {(f.bank, f.statement_id) for f in found}
        for bank in BANKS:
            if bank not in wanted:
                continue
            folder = legacy / bank
            if not folder.is_dir() or not (folder / "expected.json").exists():
                continue
            key = (bank, "legacy")
            if any(f.bank == bank for f in found):
                continue
            if key in have:
                continue
            found.append(
                FixtureRef(
                    bank=bank,
                    statement_id="legacy",
                    privacy="public",
                    path=folder,
                )
            )

    return found


def score_statement(ref: FixtureRef) -> dict[str, Any]:
    expected = json.loads((ref.path / "expected.json").read_text(encoding="utf-8"))
    text, text_source = _load_statement_text(ref.path)
    predicted = run_bank_parsers(text)
    exp_rows = list(expected.get("transactions") or [])
    pred_rows, pred_bank = _pred_rows(predicted)

    unused = list(range(len(pred_rows)))
    matched = 0
    date_ok = 0
    side_ok = 0
    amount_ok = 0
    missing = 0

    for exp in exp_rows:
        idx = None
        for i in unused:
            if _tx_key(pred_rows[i]) == _tx_key(exp):
                idx = i
                break
        if idx is None:
            for i in unused:
                pt = pred_rows[i]
                if pt.get("transaction_date") != exp.get("transaction_date"):
                    continue
                ed, ec = _amount_pair(exp)
                pd, pc = _amount_pair(pt)
                if (ed is not None and ed == pd) or (ec is not None and ec == pc):
                    idx = i
                    break
        if idx is None:
            for i in unused:
                if _amount_pair(pred_rows[i]) == _amount_pair(exp) and _amount_pair(exp) != (
                    None,
                    None,
                ):
                    idx = i
                    break

        if idx is None:
            missing += 1
            continue

        pred = pred_rows[idx]
        unused.remove(idx)
        matched += 1

        if pred.get("transaction_date") == exp.get("transaction_date"):
            date_ok += 1
        if _side(exp) is not None and _side(exp) == _side(pred):
            side_ok += 1
        if _amount_pair(exp) == _amount_pair(pred):
            amount_ok += 1

    n = len(exp_rows)
    recall = matched / n if n else 0.0
    # Accuracies are over expected rows that we matched (denominator = matched),
    # except when matched==0 → report 0.0 (measured, not invented).
    denom = matched if matched else 0
    date_acc = (date_ok / denom) if denom else 0.0
    side_acc = (side_ok / denom) if denom else 0.0
    amt_acc = (amount_ok / denom) if denom else 0.0

    stated = None
    if expected.get("closing_balance") is not None:
        m = _norm_money(expected["closing_balance"])
        stated = float(m) if m else None
    if stated is None:
        extracted = extract_stated_closing_balance(text)
        stated = float(extracted) if extracted is not None else None
    if stated is None:
        stated = _last_balance(exp_rows)
    ledger = _last_balance(pred_rows)
    tie = tie_out_balances(
        Decimal(str(stated)) if stated is not None else None,
        Decimal(str(ledger)) if ledger is not None else None,
    )

    bank_ok = (pred_bank or "").lower() == (expected.get("bank_name") or ref.bank).lower()

    return {
        "bank": ref.bank,
        "bank_label": BANK_LABEL.get(ref.bank, ref.bank.title()),
        "statement_id": ref.statement_id,
        "privacy": ref.privacy,
        "path": str(ref.path),
        "text_source": text_source,
        "expected_bank": expected.get("bank_name"),
        "predicted_bank": pred_bank,
        "bank_ok": bank_ok,
        "expected_count": n,
        "predicted_count": len(pred_rows),
        "matched": matched,
        "missing_rows": missing,
        "row_recall": round(recall, 4),
        "date_accuracy": round(date_acc, 4),
        "debit_credit_accuracy": round(side_acc, 4),
        "amount_accuracy": round(amt_acc, 4),
        "balance_tie_out": tie["tie_out"],
        "stated_closing": tie["stated_closing"],
        "ledger_closing": tie["ledger_closing"],
        "balance_match": tie["tie_out"] == "match",
    }


def _avg(values: list[float]) -> Optional[float]:
    if not values:
        return None
    return round(sum(values) / len(values), 4)


def aggregate_by_bank(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_bank: dict[str, list[dict[str, Any]]] = {b: [] for b in BANKS}
    for r in results:
        by_bank.setdefault(r["bank"], []).append(r)

    summaries = []
    for bank in BANKS:
        rows = by_bank.get(bank) or []
        if not rows:
            continue
        bal_match = sum(1 for r in rows if r.get("balance_match"))
        bal_known = sum(1 for r in rows if r.get("balance_tie_out") in ("match", "mismatch"))
        summaries.append(
            {
                "bank": bank,
                "bank_label": BANK_LABEL.get(bank, bank.title()),
                "statements": len(rows),
                "transaction_recall": _avg([r["row_recall"] for r in rows]),
                "date_accuracy": _avg([r["date_accuracy"] for r in rows]),
                "debit_credit_accuracy": _avg([r["debit_credit_accuracy"] for r in rows]),
                "amount_accuracy": _avg([r["amount_accuracy"] for r in rows]),
                "balance_matches": bal_match,
                "balance_evaluated": bal_known if bal_known else len(rows),
                "balance_unknown": sum(1 for r in rows if r.get("balance_tie_out") == "unknown"),
                "public_count": sum(1 for r in rows if r.get("privacy") == "public"),
                "private_count": sum(1 for r in rows if r.get("privacy") == "private"),
                "statements_detail": rows,
            }
        )
    return summaries


def run_bank_parser_eval(
    *,
    include_private: bool = False,
    banks: Optional[list[str]] = None,
) -> dict[str, Any]:
    fixtures = discover_fixtures(include_private=include_private, banks=banks)
    results = [score_statement(f) for f in fixtures]
    by_bank = aggregate_by_bank(results)
    return {
        "fixture_root": str(bank_eval_root()),
        "include_private": include_private,
        "statement_count": len(results),
        "has_measurements": bool(results),
        "banks": by_bank,
        "statements": results,
    }


def format_human_report(report: dict[str, Any]) -> str:
    lines: list[str] = []
    if not report.get("has_measurements"):
        lines.append("No bank-eval fixtures found.")
        lines.append(f"Expected under: {report.get('fixture_root')}/public/{{meezan,hbl,ubl}}/")
        return "\n".join(lines)

    for bank in report.get("banks") or []:
        lines.append(f"Bank:")
        lines.append(bank["bank_label"])
        lines.append("")
        lines.append("Statements:")
        lines.append(str(bank["statements"]))
        lines.append("")
        lines.append("Transaction recall:")
        recall = bank.get("transaction_recall")
        lines.append(f"{round(recall * 100)}%" if recall is not None else "—")
        lines.append("")
        lines.append("Date accuracy:")
        d = bank.get("date_accuracy")
        lines.append(f"{round(d * 100)}%" if d is not None else "—")
        lines.append("")
        lines.append("Debit/credit accuracy:")
        s = bank.get("debit_credit_accuracy")
        lines.append(f"{round(s * 100)}%" if s is not None else "—")
        lines.append("")
        lines.append("Amount accuracy:")
        a = bank.get("amount_accuracy")
        lines.append(f"{round(a * 100)}%" if a is not None else "—")
        lines.append("")
        lines.append("Balance matches:")
        lines.append(f"{bank['balance_matches']}/{bank['balance_evaluated']}")
        lines.append("")
        lines.append("---")
        lines.append("")

    # Drop trailing separator
    while lines and lines[-1] in ("", "---"):
        lines.pop()
    return "\n".join(lines)


def ci_thresholds_ok(
    report: dict[str, Any],
    *,
    min_recall: float = 0.95,
    min_amount_accuracy: float = 0.95,
    require_all_banks: bool = True,
) -> tuple[bool, list[str]]:
    """Return (ok, failure_reasons) for CI gates on public fixtures."""
    reasons: list[str] = []
    banks = report.get("banks") or []
    if not banks:
        return False, ["No measured fixtures — refusing to pass CI with empty eval"]

    seen = {b["bank"] for b in banks}
    if require_all_banks:
        for b in BANKS:
            if b not in seen:
                reasons.append(f"Missing public fixtures for bank: {b}")

    for b in banks:
        label = b["bank_label"]
        recall = b.get("transaction_recall")
        amt = b.get("amount_accuracy")
        if recall is None or recall < min_recall:
            reasons.append(
                f"{label}: transaction recall {recall} below {min_recall}"
            )
        if amt is None or amt < min_amount_accuracy:
            reasons.append(
                f"{label}: amount accuracy {amt} below {min_amount_accuracy}"
            )
    return (len(reasons) == 0), reasons
