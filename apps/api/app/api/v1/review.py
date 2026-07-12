from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy.orm import joinedload

from app.core.deps import CurrentUser, DbSession
from app.models.category_rule import CategoryRule, MatchType
from app.schemas import (
    CategoryRuleCreate,
    CategoryRuleOut,
    CategoryRuleUpdate,
    PeriodCloseOut,
    PeriodCloseRequest,
    ReviewStatus,
)
from app.services.audit import AuditAction, write_audit
from app.services.categories import assert_category_usable, category_to_out
from app.services.clients import ensure_default_client
from app.services.period_close import (
    list_closes,
    lock_period,
    period_bounds,
    review_status,
    unlock_period,
)
from app.services.rules import normalize_pattern

router = APIRouter(tags=["review-rules-close"])


def _rule_out(rule: CategoryRule) -> CategoryRuleOut:
    cat = category_to_out(rule.category) if rule.category else None
    return CategoryRuleOut(
        id=rule.id,
        pattern=rule.pattern,
        match_type=rule.match_type.value,
        category_id=rule.category_id,
        category=cat,
        priority=rule.priority,
    )


@router.get("/review/status", response_model=ReviewStatus)
def get_review_status(
    user: CurrentUser,
    db: DbSession,
    period_start: Optional[str] = Query(None),
    period_end: Optional[str] = Query(None),
) -> ReviewStatus:
    from datetime import date

    from sqlalchemy import func

    from app.models.transaction import Transaction

    if period_start and period_end:
        try:
            start = date.fromisoformat(period_start)
            end = date.fromisoformat(period_end)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid dates") from exc
        if end < start:
            raise HTTPException(status_code=400, detail="Invalid period")
        return review_status(db, user.organization_id, start, end)

    # Org-wide status when no period is provided
    row = (
        db.query(
            func.min(Transaction.transaction_date),
            func.max(Transaction.transaction_date),
        )
        .filter(Transaction.organization_id == user.organization_id)
        .first()
    )
    min_d, max_d = row if row else (None, None)
    if not min_d or not max_d:
        today = date.today()
        return review_status(db, user.organization_id, today, today)
    return review_status(db, user.organization_id, min_d, max_d)


@router.get("/rules", response_model=list[CategoryRuleOut])
def list_rules(user: CurrentUser, db: DbSession) -> list[CategoryRuleOut]:
    rules = (
        db.query(CategoryRule)
        .options(joinedload(CategoryRule.category))
        .filter(CategoryRule.organization_id == user.organization_id)
        .order_by(CategoryRule.priority.asc(), CategoryRule.pattern.asc())
        .all()
    )
    return [_rule_out(r) for r in rules]


@router.post("/rules", response_model=CategoryRuleOut, status_code=201)
def create_rule(
    payload: CategoryRuleCreate, user: CurrentUser, db: DbSession
) -> CategoryRuleOut:
    try:
        cat = assert_category_usable(db, user.organization_id, payload.category_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        match_type = MatchType(payload.match_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="match_type must be contains|exact") from exc

    pattern = (
        normalize_pattern(payload.pattern)
        if match_type == MatchType.CONTAINS
        else payload.pattern.strip().lower()
    )
    existing = (
        db.query(CategoryRule)
        .filter(
            CategoryRule.organization_id == user.organization_id,
            CategoryRule.pattern == pattern,
            CategoryRule.match_type == match_type,
        )
        .first()
    )
    if existing:
        existing.category_id = cat.id
        existing.priority = payload.priority
        rule = existing
    else:
        rule = CategoryRule(
            organization_id=user.organization_id,
            match_type=match_type,
            pattern=pattern,
            category_id=cat.id,
            priority=payload.priority,
        )
        db.add(rule)
    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="rule.upsert",
        entity_type="category_rule",
        entity_id=str(getattr(rule, "id", "")),
        meta={"pattern": pattern, "category_id": str(cat.id)},
    )
    db.commit()
    db.refresh(rule)
    rule = (
        db.query(CategoryRule)
        .options(joinedload(CategoryRule.category))
        .filter(CategoryRule.id == rule.id)
        .first()
    )
    assert rule is not None
    return _rule_out(rule)


@router.patch("/rules/{rule_id}", response_model=CategoryRuleOut)
def update_rule(
    rule_id: UUID, payload: CategoryRuleUpdate, user: CurrentUser, db: DbSession
) -> CategoryRuleOut:
    rule = (
        db.query(CategoryRule)
        .options(joinedload(CategoryRule.category))
        .filter(
            CategoryRule.id == rule_id,
            CategoryRule.organization_id == user.organization_id,
        )
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    if payload.category_id is not None:
        try:
            cat = assert_category_usable(db, user.organization_id, payload.category_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        rule.category_id = cat.id
    if payload.pattern is not None:
        rule.pattern = normalize_pattern(payload.pattern)
    if payload.priority is not None:
        rule.priority = payload.priority
    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="rule.update",
        entity_type="category_rule",
        entity_id=str(rule.id),
    )
    db.commit()
    db.refresh(rule)
    return _rule_out(rule)


@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: UUID, user: CurrentUser, db: DbSession) -> None:
    rule = (
        db.query(CategoryRule)
        .filter(
            CategoryRule.id == rule_id,
            CategoryRule.organization_id == user.organization_id,
        )
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="rule.delete",
        entity_type="category_rule",
        entity_id=str(rule.id),
        meta={"pattern": rule.pattern},
    )
    db.delete(rule)
    db.commit()


@router.get("/close", response_model=list[PeriodCloseOut])
def list_period_closes(user: CurrentUser, db: DbSession) -> list[PeriodCloseOut]:
    rows = list_closes(db, user.organization_id)
    return [
        PeriodCloseOut(
            id=r.id,
            period_key=r.period_key,
            period_start=r.period_start.isoformat(),
            period_end=r.period_end.isoformat(),
            locked_at=r.locked_at.isoformat(),
        )
        for r in rows
    ]


@router.post("/close", response_model=PeriodCloseOut)
def close_period(
    payload: PeriodCloseRequest, user: CurrentUser, db: DbSession
) -> PeriodCloseOut:
    try:
        row = lock_period(
            db,
            organization_id=user.organization_id,
            user_id=user.id,
            period_key=payload.period_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        client_id=ensure_default_client(db, user.organization_id).id,
        action=AuditAction.PERIOD_LOCK,
        entity_type="period_close",
        entity_id=str(row.id),
        after={
            "period_key": row.period_key,
            "period_start": row.period_start.isoformat(),
            "period_end": row.period_end.isoformat(),
            "locked_at": row.locked_at.isoformat() if row.locked_at else None,
        },
    )
    db.commit()
    db.refresh(row)
    return PeriodCloseOut(
        id=row.id,
        period_key=row.period_key,
        period_start=row.period_start.isoformat(),
        period_end=row.period_end.isoformat(),
        locked_at=row.locked_at.isoformat(),
    )


@router.delete("/close/{period_key}", status_code=204)
def reopen_period(period_key: str, user: CurrentUser, db: DbSession) -> None:
    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        client_id=ensure_default_client(db, user.organization_id).id,
        action=AuditAction.PERIOD_UNLOCK,
        entity_type="period_close",
        entity_id=period_key,
        before={"period_key": period_key, "locked": True},
        after={"period_key": period_key, "locked": False},
    )
    unlock_period(db, user.organization_id, period_key)
    db.commit()


@router.get("/close/{period_key}/status", response_model=ReviewStatus)
def close_period_status(period_key: str, user: CurrentUser, db: DbSession) -> ReviewStatus:
    try:
        start, end = period_bounds(period_key)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="period_key must be YYYY-MM") from exc
    return review_status(db, user.organization_id, start, end)
