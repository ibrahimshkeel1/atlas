from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from app.core.deps import CurrentUser, DbSession
from app.services.bank_parser_eval import run_bank_parser_eval
from app.services.eval_dashboard import (
    get_latest_run,
    get_run,
    list_runs,
    run_and_persist_eval,
    serialize_run,
)

router = APIRouter(prefix="/eval", tags=["eval"])


@router.get("/latest")
def eval_latest(_user: CurrentUser, db: DbSession) -> dict:
    """Latest succeeded evaluation run. Empty payload if none stored yet."""
    run = get_latest_run(db)
    if not run:
        return {
            "run": None,
            "message": "No evaluation runs yet. Trigger a run against real test fixtures.",
        }
    return {"run": serialize_run(run, include_details=True)}


@router.get("/runs")
def eval_runs(
    _user: CurrentUser,
    db: DbSession,
    limit: int = Query(20, ge=1, le=100),
) -> dict:
    runs = list_runs(db, limit=limit)
    return {
        "runs": [serialize_run(r, include_details=False) for r in runs],
    }


@router.get("/runs/{run_id}")
def eval_run_detail(run_id: UUID, _user: CurrentUser, db: DbSession) -> dict:
    run = get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Eval run not found")
    return {"run": serialize_run(run, include_details=True)}


@router.post("/run")
def trigger_eval(user: CurrentUser, db: DbSession) -> dict:
    """
    Run extraction + categorization evaluation against bundled test fixtures
    and persist measured results. Does not invent accuracy numbers.
    """
    run = run_and_persist_eval(
        db,
        triggered_by_user_id=user.id,
        organization_id=user.organization_id,
        source="manual",
    )
    if run.status == "failed":
        raise HTTPException(
            status_code=500,
            detail=run.error or "Evaluation failed",
        )
    full = get_run(db, run.id) or run
    return {"run": serialize_run(full, include_details=True)}


@router.get("/bank-parsers")
def bank_parser_report(_user: CurrentUser) -> dict:
    """
    Live Meezan/HBL/UBL parser scores against public bank-eval fixtures.
    Private customer fixtures are never loaded via the API.
    """
    return {"report": run_bank_parser_eval(include_private=False)}


@router.post("/bank-parsers/run")
def bank_parser_run(_user: CurrentUser) -> dict:
    """Re-run public bank parser evaluation (explicit refresh)."""
    return {"report": run_bank_parser_eval(include_private=False)}
