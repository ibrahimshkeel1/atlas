from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models.period_close import PeriodClose
from app.models.transaction import Transaction
from app.schemas import ReviewStatus


def period_bounds(period_key: str) -> tuple[date, date]:
    year_s, month_s = period_key.split("-")
    year, month = int(year_s), int(month_s)
    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])
    return start, end


def get_period_close(db: Session, organization_id: UUID, period_key: str) -> PeriodClose | None:
    return (
        db.query(PeriodClose)
        .filter(
            PeriodClose.organization_id == organization_id,
            PeriodClose.period_key == period_key,
        )
        .first()
    )


def is_period_locked(db: Session, organization_id: UUID, day: date) -> bool:
    key = f"{day.year:04d}-{day.month:02d}"
    return get_period_close(db, organization_id, key) is not None


def review_status(
    db: Session,
    organization_id: UUID,
    period_start: date,
    period_end: date,
) -> ReviewStatus:
    q = db.query(Transaction).filter(
        Transaction.organization_id == organization_id,
        Transaction.transaction_date >= period_start,
        Transaction.transaction_date <= period_end,
    )
    total = q.count()
    needs = q.filter(Transaction.needs_review.is_(True)).count()
    period_key = None
    if period_start.year == period_end.year and period_start.month == period_end.month:
        period_key = f"{period_start.year:04d}-{period_start.month:02d}"
    locked = bool(period_key and get_period_close(db, organization_id, period_key))
    return ReviewStatus(
        period_start=period_start.isoformat(),
        period_end=period_end.isoformat(),
        transaction_count=total,
        needs_review_count=needs,
        reviewed_count=max(total - needs, 0),
        is_locked=locked,
        can_export=needs == 0 and total > 0,
        period_key=period_key,
    )


def lock_period(
    db: Session,
    *,
    organization_id: UUID,
    user_id: UUID,
    period_key: str,
) -> PeriodClose:
    start, end = period_bounds(period_key)
    status = review_status(db, organization_id, start, end)
    if status.transaction_count == 0:
        raise ValueError("No transactions in this period")
    if status.needs_review_count > 0:
        raise ValueError(
            f"{status.needs_review_count} transactions still need review before closing"
        )
    existing = get_period_close(db, organization_id, period_key)
    if existing:
        return existing
    row = PeriodClose(
        organization_id=organization_id,
        period_key=period_key,
        period_start=start,
        period_end=end,
        locked_at=datetime.now(timezone.utc),
        locked_by_user_id=user_id,
    )
    db.add(row)
    db.flush()
    return row


def unlock_period(db: Session, organization_id: UUID, period_key: str) -> None:
    row = get_period_close(db, organization_id, period_key)
    if row:
        db.delete(row)
        db.flush()


def list_closes(db: Session, organization_id: UUID) -> list[PeriodClose]:
    return (
        db.query(PeriodClose)
        .filter(PeriodClose.organization_id == organization_id)
        .order_by(PeriodClose.period_key.desc())
        .all()
    )


def assert_not_locked_for_tx(db: Session, organization_id: UUID, tx: Transaction) -> None:
    if is_period_locked(db, organization_id, tx.transaction_date):
        raise ValueError("This period is closed. Unlock it before editing transactions.")
