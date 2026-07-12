from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.core.deps import CurrentUser, DbSession
from app.schemas import ReportRequest
from app.services.audit import AuditAction, write_audit
from app.services.dashboard import report_payload
from app.services.period_close import review_status
from app.services.reports import create_export
from app.services.clients import ensure_default_client

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/bounds")
def get_report_bounds(user: CurrentUser, db: DbSession) -> dict:
    from sqlalchemy import func
    from app.models.transaction import Transaction

    row = (
        db.query(
            func.min(Transaction.transaction_date),
            func.max(Transaction.transaction_date),
            func.count(Transaction.id),
        )
        .filter(Transaction.organization_id == user.organization_id)
        .first()
    )
    min_date, max_date, count = row if row else (None, None, 0)
    return {
        "period_start": min_date.isoformat() if min_date else None,
        "period_end": max_date.isoformat() if max_date else None,
        "transaction_count": int(count or 0),
    }


@router.get("/summary")
def get_report_summary(
    user: CurrentUser,
    db: DbSession,
    period_start: date = Query(...),
    period_end: date = Query(...),
) -> dict:
    if period_end < period_start:
        raise HTTPException(status_code=400, detail="Invalid period")
    payload = report_payload(db, user.organization_id, period_start, period_end)
    status = review_status(db, user.organization_id, period_start, period_end)
    payload["needs_review_count"] = status.needs_review_count
    payload["can_export"] = status.can_export
    payload["is_locked"] = status.is_locked
    return payload


@router.post("/export")
def export_report(payload: ReportRequest, user: CurrentUser, db: DbSession) -> dict:
    try:
        start = date.fromisoformat(payload.period_start)
        end = date.fromisoformat(payload.period_end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid dates") from exc
    if end < start:
        raise HTTPException(status_code=400, detail="Invalid period")
    if payload.format not in {"xlsx", "pdf"}:
        raise HTTPException(status_code=400, detail="format must be xlsx or pdf")

    status = review_status(db, user.organization_id, start, end)
    if status.transaction_count == 0:
        raise HTTPException(status_code=400, detail="No transactions in this period")
    if status.needs_review_count > 0 and not payload.force:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{status.needs_review_count} transactions still need review. "
                "Finish review on Transactions, or pass force=true to export anyway."
            ),
        )

    result = create_export(
        db,
        organization_id=user.organization_id,
        report_type=payload.report_type,
        period_start=start,
        period_end=end,
        fmt=payload.format,
        prepared_by_user_id=user.id,
    )
    client = ensure_default_client(db, user.organization_id)
    forced = bool(payload.force and status.needs_review_count > 0)
    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        client_id=client.id,
        action=AuditAction.REPORT_EXPORT_FORCED if forced else AuditAction.REPORT_EXPORT,
        entity_type="report",
        entity_id=result["id"],
        after={
            "format": payload.format,
            "type": payload.report_type,
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
        },
        meta={
            "forced": forced,
            "needs_review_count": status.needs_review_count,
        },
    )
    db.commit()
    return result
