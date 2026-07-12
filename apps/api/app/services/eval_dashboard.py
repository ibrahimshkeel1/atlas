"""Internal Atlas evaluation runner — measures fixtures only, persists runs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models.eval_run import EvalFixtureResult, EvalRun
from app.services.accuracy import fixtures_root, score_fixture
from app.services.categorization_eval import CATEGORIZATION_FIXTURES
from app.services.parsers import parser_method_label, run_bank_parsers
from app.services.rules import resolve_category
from app.services.merchants import seed_system_merchants


def evaluate_fixture_folder(folder: Path) -> dict[str, Any]:
    """Run measured extraction (+ optional PDF OCR probe) for one fixture bank."""
    name = folder.name
    expected_path = folder / "expected.json"
    text_path = folder / "statement.txt"
    pdf_path = folder / "statement.pdf"

    if not expected_path.exists() or not text_path.exists():
        return {
            "fixture": name,
            "failed": True,
            "error": "Missing expected.json or statement.txt",
            "used_ocr": False,
            "ai_fallback": False,
            "parser_used": None,
            "missing_rows": 0,
            "wrong_amounts": 0,
            "wrong_dates": 0,
            "matched": 0,
            "expected_count": 0,
            "predicted_count": 0,
            "recall": None,
            "precision": None,
            "f1": None,
            "balance_tie_out": "unknown",
            "bank_ok": False,
        }

    expected = json.loads(expected_path.read_text())
    text = text_path.read_text()
    used_ocr = False
    ocr_error: Optional[str] = None
    ai_fallback = False  # Fixture text path uses bank parsers only — measured as False

    if pdf_path.exists():
        try:
            from app.services.pdf_extract import extract_pdf_pages

            pages, used_ocr = extract_pdf_pages(pdf_path.read_bytes())
            used_ocr = bool(used_ocr)
            if not pages:
                ocr_error = "PDF present but no pages extracted"
        except Exception as exc:  # noqa: BLE001
            ocr_error = str(exc)[:500]

    try:
        predicted = run_bank_parsers(text)
        scored = score_fixture(name, expected, predicted, text=text)
        parser_used = parser_method_label(getattr(predicted, "bank_name", None))
        scored.update(
            {
                "used_ocr": used_ocr,
                "ai_fallback": ai_fallback,
                "parser_used": parser_used,
                "failed": False,
                "error": ocr_error,
            }
        )
        return scored
    except Exception as exc:  # noqa: BLE001
        return {
            "fixture": name,
            "failed": True,
            "error": str(exc)[:500],
            "used_ocr": used_ocr,
            "ai_fallback": ai_fallback,
            "parser_used": None,
            "expected_bank": expected.get("bank_name"),
            "predicted_bank": None,
            "bank_ok": False,
            "expected_count": len(expected.get("transactions") or []),
            "predicted_count": 0,
            "matched": 0,
            "missing_rows": len(expected.get("transactions") or []),
            "wrong_amounts": 0,
            "wrong_dates": 0,
            "recall": 0.0,
            "precision": 0.0,
            "f1": 0.0,
            "balance_tie_out": "unknown",
            "stated_closing": None,
            "ledger_closing": None,
        }


def measure_categorization(db: Session, organization_id: Optional[UUID]) -> dict[str, Any]:
    """
    Measured categorization on labeled description fixtures.
    review_percentage = share that would need review (Other after resolve).
    Does not invent a synthetic 'before' accuracy for the dashboard.
    """
    seed_system_merchants(db)
    db.flush()

    org_id = organization_id
    if org_id is None:
        from app.models.organization import Organization

        org = db.query(Organization).first()
        org_id = org.id if org else UUID("00000000-0000-0000-0000-000000000001")

    correct = 0
    other = 0
    needs_review = 0
    details: list[dict[str, Any]] = []

    for row in CATEGORIZATION_FIXTURES:
        cat, from_det, merchant = resolve_category(
            db,
            organization_id=org_id,
            description=row["description"],
            ai_category_slug="other",
        )
        ok = cat.slug == row["category_slug"]
        if ok:
            correct += 1
        if cat.slug == "other":
            other += 1
        # Measured review rate: Other always needs review; non-deterministic hits need review
        review = cat.slug == "other" or not from_det
        if review:
            needs_review += 1

        details.append(
            {
                "description": row["description"],
                "expected_category": row["category_slug"],
                "predicted_category": cat.slug,
                "expected_merchant": row["merchant_slug"],
                "predicted_merchant": merchant.slug if merchant else None,
                "correct": ok,
                "needs_review": review,
            }
        )

    n = len(CATEGORIZATION_FIXTURES)
    if n == 0:
        return {
            "fixture_count": 0,
            "category_accuracy": None,
            "other_percentage": None,
            "review_percentage": None,
            "details": [],
            "has_measurements": False,
        }

    return {
        "fixture_count": n,
        "category_accuracy": round(correct / n, 4),
        "other_percentage": round(other / n, 4),
        "review_percentage": round(needs_review / n, 4),
        "correct_count": correct,
        "other_count": other,
        "needs_review_count": needs_review,
        "details": details,
        "has_measurements": True,
    }


def run_and_persist_eval(
    db: Session,
    *,
    triggered_by_user_id: Optional[UUID] = None,
    organization_id: Optional[UUID] = None,
    source: str = "manual",
    notes: Optional[str] = None,
) -> EvalRun:
    """Execute full measured eval suite and store results."""
    run = EvalRun(
        triggered_by_user_id=triggered_by_user_id,
        status="running",
        source=source,
        notes=notes,
    )
    db.add(run)
    db.flush()

    try:
        root = fixtures_root()
        fixture_scores: list[dict[str, Any]] = []
        if root.exists():
            for folder in sorted(root.iterdir()):
                if not folder.is_dir():
                    continue
                if not (folder / "expected.json").exists():
                    continue
                fixture_scores.append(evaluate_fixture_folder(folder))

        cat = measure_categorization(db, organization_id)

        parser_counts: dict[str, int] = {}
        missing = wrong_amt = wrong_dt = 0
        bal_match = bal_mis = bal_unk = 0
        ocr_n = ai_n = fail_n = 0
        recalls: list[float] = []

        for s in fixture_scores:
            row = EvalFixtureResult(
                eval_run_id=run.id,
                fixture_name=s.get("fixture") or "unknown",
                expected_bank=s.get("expected_bank"),
                predicted_bank=s.get("predicted_bank"),
                bank_ok=bool(s.get("bank_ok")),
                expected_count=int(s.get("expected_count") or 0),
                predicted_count=int(s.get("predicted_count") or 0),
                matched=int(s.get("matched") or 0),
                missing_rows=int(s.get("missing_rows") or 0),
                wrong_amounts=int(s.get("wrong_amounts") or 0),
                wrong_dates=int(s.get("wrong_dates") or 0),
                recall=s.get("recall"),
                precision=s.get("precision"),
                f1=s.get("f1"),
                balance_tie_out=s.get("balance_tie_out") or "unknown",
                stated_closing=s.get("stated_closing"),
                ledger_closing=s.get("ledger_closing"),
                used_ocr=bool(s.get("used_ocr")),
                ai_fallback=bool(s.get("ai_fallback")),
                parser_used=s.get("parser_used"),
                failed=bool(s.get("failed")),
                error=s.get("error"),
                detail_json={
                    k: s.get(k)
                    for k in (
                        "amount_accuracy",
                        "date_accuracy",
                        "description_accuracy",
                        "balance_difference",
                    )
                },
            )
            db.add(row)

            missing += row.missing_rows
            wrong_amt += row.wrong_amounts
            wrong_dt += row.wrong_dates
            if row.recall is not None:
                recalls.append(float(row.recall))
            if row.balance_tie_out == "match":
                bal_match += 1
            elif row.balance_tie_out == "mismatch":
                bal_mis += 1
            else:
                bal_unk += 1
            if row.used_ocr:
                ocr_n += 1
            if row.ai_fallback:
                ai_n += 1
            if row.failed:
                fail_n += 1
            if row.parser_used:
                parser_counts[row.parser_used] = parser_counts.get(row.parser_used, 0) + 1

        run.statements_tested = len(fixture_scores)
        run.transaction_recall = round(sum(recalls) / len(recalls), 4) if recalls else None
        run.missing_rows = missing
        run.wrong_amounts = wrong_amt
        run.wrong_dates = wrong_dt
        run.category_accuracy = cat.get("category_accuracy")
        run.other_percentage = cat.get("other_percentage")
        run.review_percentage = cat.get("review_percentage")
        run.categorization_fixture_count = int(cat.get("fixture_count") or 0)
        run.balance_matches = bal_match
        run.balance_mismatches = bal_mis
        run.balance_unknown = bal_unk
        run.ocr_usage_count = ocr_n
        run.ai_fallback_count = ai_n
        run.failure_count = fail_n
        run.parser_counts_json = parser_counts
        run.summary_json = {
            "has_extraction_measurements": bool(fixture_scores),
            "has_categorization_measurements": bool(cat.get("has_measurements")),
            "extraction_fixtures": fixture_scores,
            "categorization": cat,
        }
        run.status = "succeeded"
        run.error = None
        db.commit()
        db.refresh(run)
        return run
    except Exception as exc:  # noqa: BLE001
        err = str(exc)[:2000]
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        run = EvalRun(
            triggered_by_user_id=triggered_by_user_id,
            status="failed",
            source=source,
            notes=notes,
            error=err,
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        return run


def serialize_run(run: EvalRun, *, include_details: bool = True) -> dict[str, Any]:
    fixtures = []
    if include_details:
        for r in run.fixture_results or []:
            fixtures.append(
                {
                    "id": str(r.id),
                    "fixture_name": r.fixture_name,
                    "expected_bank": r.expected_bank,
                    "predicted_bank": r.predicted_bank,
                    "bank_ok": r.bank_ok,
                    "expected_count": r.expected_count,
                    "predicted_count": r.predicted_count,
                    "matched": r.matched,
                    "missing_rows": r.missing_rows,
                    "wrong_amounts": r.wrong_amounts,
                    "wrong_dates": r.wrong_dates,
                    "recall": r.recall,
                    "precision": r.precision,
                    "f1": r.f1,
                    "balance_tie_out": r.balance_tie_out,
                    "stated_closing": r.stated_closing,
                    "ledger_closing": r.ledger_closing,
                    "used_ocr": r.used_ocr,
                    "ai_fallback": r.ai_fallback,
                    "parser_used": r.parser_used,
                    "failed": r.failed,
                    "error": r.error,
                    "detail": r.detail_json,
                }
            )

    cat = (run.summary_json or {}).get("categorization") if include_details else None

    return {
        "id": str(run.id),
        "status": run.status,
        "source": run.source,
        "notes": run.notes,
        "error": run.error,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "triggered_by_user_id": str(run.triggered_by_user_id)
        if run.triggered_by_user_id
        else None,
        "extraction": {
            "statements_tested": run.statements_tested,
            "transaction_recall": run.transaction_recall,
            "missing_rows": run.missing_rows,
            "wrong_amounts": run.wrong_amounts,
            "wrong_dates": run.wrong_dates,
        },
        "categorization": {
            "fixture_count": run.categorization_fixture_count,
            "category_accuracy": run.category_accuracy,
            "other_percentage": run.other_percentage,
            "review_percentage": run.review_percentage,
            "details": (cat or {}).get("details") if include_details else None,
        },
        "reconciliation": {
            "balance_matches": run.balance_matches,
            "balance_mismatches": run.balance_mismatches,
            "balance_unknown": run.balance_unknown,
        },
        "processing": {
            "ocr_usage_count": run.ocr_usage_count,
            "ai_fallback_count": run.ai_fallback_count,
            "failure_count": run.failure_count,
            "parser_counts": run.parser_counts_json or {},
        },
        "has_measurements": run.statements_tested > 0
        or run.categorization_fixture_count > 0,
        "fixtures": fixtures,
    }


def get_latest_run(db: Session) -> Optional[EvalRun]:
    return (
        db.query(EvalRun)
        .options(joinedload(EvalRun.fixture_results))
        .filter(EvalRun.status == "succeeded")
        .order_by(EvalRun.created_at.desc())
        .first()
    )


def list_runs(db: Session, *, limit: int = 20) -> list[EvalRun]:
    return (
        db.query(EvalRun)
        .order_by(EvalRun.created_at.desc())
        .limit(limit)
        .all()
    )


def get_run(db: Session, run_id: UUID) -> Optional[EvalRun]:
    return (
        db.query(EvalRun)
        .options(joinedload(EvalRun.fixture_results))
        .filter(EvalRun.id == run_id)
        .first()
    )
