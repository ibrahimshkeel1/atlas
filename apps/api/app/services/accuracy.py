from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

from app.services.parsers import run_bank_parsers
from app.services.statement_balance import extract_stated_closing_balance, tie_out_balances


def _fixtures_root() -> Path:
    # Prefer monorepo sample-data (includes statement.pdf for OCR probes); fall back to API copy.
    candidates = [
        Path(__file__).resolve().parents[4] / "sample-data" / "fixtures",
        Path(__file__).resolve().parents[2] / "fixtures",  # apps/api/fixtures
        Path.cwd() / "sample-data" / "fixtures",
        Path.cwd() / "fixtures",
        Path.cwd().parent.parent / "sample-data" / "fixtures",
    ]
    for path in candidates:
        if path.exists():
            return path
    return candidates[0]


def fixtures_root() -> Path:
    return _fixtures_root()


def _norm_money(v: Any) -> Optional[str]:
    if v is None or v == "":
        return None
    s = str(v).replace(",", "").strip()
    try:
        return f"{float(s):.2f}"
    except ValueError:
        return None


def _norm_desc(s: str) -> str:
    s = re.sub(r"\s+", " ", s.lower()).strip()
    return s[:80]


def _tx_key(tx: dict) -> tuple:
    return (
        tx.get("transaction_date"),
        _norm_money(tx.get("debit")),
        _norm_money(tx.get("credit")),
    )


def _amount_pair(tx: dict) -> tuple[Optional[str], Optional[str]]:
    return _norm_money(tx.get("debit")), _norm_money(tx.get("credit"))


def _last_balance(rows: list[dict]) -> Optional[float]:
    for tx in reversed(rows):
        bal = _norm_money(tx.get("balance"))
        if bal is not None:
            try:
                return float(bal)
            except ValueError:
                continue
    return None


def score_fixture(name: str, expected: dict, predicted, *, text: str = "") -> dict:
    """Score one fixture. All rates are measured against expected.json — never invented."""
    exp_rows = expected.get("transactions") or []
    if hasattr(predicted, "transactions"):
        pred_rows = [
            {
                "transaction_date": t.transaction_date,
                "description": t.description,
                "debit": t.debit,
                "credit": t.credit,
                "balance": t.balance,
            }
            for t in predicted.transactions
        ]
        pred_bank = predicted.bank_name
    else:
        pred_rows = list(predicted.get("transactions") or [])
        pred_bank = predicted.get("bank_name")

    unused_pred = list(range(len(pred_rows)))
    matched = 0
    amount_ok = 0
    date_ok = 0
    desc_ok = 0
    wrong_amounts = 0
    wrong_dates = 0
    missing_rows = 0

    for exp in exp_rows:
        # Exact key match first
        exact_idx = None
        for i in unused_pred:
            if _tx_key(pred_rows[i]) == _tx_key(exp):
                exact_idx = i
                break

        if exact_idx is not None:
            pred = pred_rows[exact_idx]
            unused_pred.remove(exact_idx)
            matched += 1
            date_ok += 1
            amount_ok += 1
            if _norm_desc(exp.get("description", "")) in _norm_desc(
                pred.get("description", "")
            ) or _norm_desc(pred.get("description", "")) in _norm_desc(
                exp.get("description", "")
            ):
                desc_ok += 1
            continue

        # Soft: same date, one amount side matches
        soft_idx = None
        for i in unused_pred:
            pt = pred_rows[i]
            if pt.get("transaction_date") != exp.get("transaction_date"):
                continue
            ed, ec = _amount_pair(exp)
            pd, pc = _amount_pair(pt)
            if (ed is not None and ed == pd) or (ec is not None and ec == pc):
                soft_idx = i
                break

        if soft_idx is not None:
            pred = pred_rows[soft_idx]
            unused_pred.remove(soft_idx)
            matched += 1
            date_ok += 1
            if _amount_pair(exp) == _amount_pair(pred):
                amount_ok += 1
            else:
                wrong_amounts += 1
            if _norm_desc(exp.get("description", "")) in _norm_desc(
                pred.get("description", "")
            ) or _norm_desc(pred.get("description", "")) in _norm_desc(
                exp.get("description", "")
            ):
                desc_ok += 1
            continue

        # Soft: same amounts, wrong/missing date
        soft_amt_idx = None
        for i in unused_pred:
            if _amount_pair(pred_rows[i]) == _amount_pair(exp) and _amount_pair(exp) != (
                None,
                None,
            ):
                soft_amt_idx = i
                break

        if soft_amt_idx is not None:
            pred = pred_rows[soft_amt_idx]
            unused_pred.remove(soft_amt_idx)
            matched += 1
            amount_ok += 1
            wrong_dates += 1
            if pred.get("transaction_date") == exp.get("transaction_date"):
                date_ok += 1
                wrong_dates -= 1
            continue

        missing_rows += 1

    total_exp = len(exp_rows)
    total_pred = len(pred_rows)
    recall = matched / total_exp if total_exp else 0.0
    precision = matched / total_pred if total_pred else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    bank_ok = (pred_bank or "").lower() == (expected.get("bank_name") or "").lower()

    stated = None
    if expected.get("closing_balance") is not None:
        try:
            stated = float(_norm_money(expected["closing_balance"]) or "nan")
            if stated != stated:  # NaN
                stated = None
        except (TypeError, ValueError):
            stated = None
    if stated is None and text:
        from decimal import Decimal

        extracted = extract_stated_closing_balance(text)
        stated = float(extracted) if extracted is not None else None
    if stated is None:
        stated = _last_balance(exp_rows)

    ledger = _last_balance(pred_rows)
    from decimal import Decimal

    tie = tie_out_balances(
        Decimal(str(stated)) if stated is not None else None,
        Decimal(str(ledger)) if ledger is not None else None,
    )

    return {
        "fixture": name,
        "expected_bank": expected.get("bank_name"),
        "predicted_bank": pred_bank,
        "bank_ok": bank_ok,
        "expected_count": total_exp,
        "predicted_count": total_pred,
        "matched": matched,
        "missing_rows": missing_rows,
        "wrong_amounts": wrong_amounts,
        "wrong_dates": wrong_dates,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "amount_accuracy": round(amount_ok / total_exp, 4) if total_exp else 0.0,
        "date_accuracy": round(date_ok / total_exp, 4) if total_exp else 0.0,
        "description_accuracy": round(desc_ok / total_exp, 4) if total_exp else 0.0,
        "balance_tie_out": tie["tie_out"],
        "stated_closing": tie["stated_closing"],
        "ledger_closing": tie["ledger_closing"],
        "balance_difference": tie["difference"],
    }


def run_eval() -> dict:
    """Lightweight report used by legacy /accuracy/report (measured fixtures only)."""
    root = _fixtures_root()
    results = []
    if root.exists():
        for folder in sorted(root.iterdir()):
            if not folder.is_dir():
                continue
            expected_path = folder / "expected.json"
            text_path = folder / "statement.txt"
            if not expected_path.exists() or not text_path.exists():
                continue
            expected = json.loads(expected_path.read_text())
            text = text_path.read_text()
            predicted = run_bank_parsers(text)
            results.append(score_fixture(folder.name, expected, predicted, text=text))

    if not results:
        return {
            "fixtures": [],
            "summary": {
                "fixture_count": 0,
                "avg_f1": None,
                "avg_recall": None,
                "avg_precision": None,
                "sellable_bar": False,
                "has_measurements": False,
            },
        }

    avg_f1 = sum(r["f1"] for r in results) / len(results)
    avg_recall = sum(r["recall"] for r in results) / len(results)
    avg_precision = sum(r["precision"] for r in results) / len(results)
    banks_ok = sum(1 for r in results if r["bank_ok"])
    return {
        "fixtures": results,
        "summary": {
            "fixture_count": len(results),
            "banks_detected_ok": banks_ok,
            "avg_precision": round(avg_precision, 4),
            "avg_recall": round(avg_recall, 4),
            "avg_f1": round(avg_f1, 4),
            "missing_rows": sum(r["missing_rows"] for r in results),
            "wrong_amounts": sum(r["wrong_amounts"] for r in results),
            "wrong_dates": sum(r["wrong_dates"] for r in results),
            "sellable_bar": avg_f1 >= 0.95 and banks_ok == len(results),
            "has_measurements": True,
        },
    }
