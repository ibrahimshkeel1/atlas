from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func as sa_func
from sqlalchemy.orm import joinedload

from app.core.config import get_settings
from app.core.deps import CurrentUser, DbSession
from app.models.transaction import Transaction
from app.schemas import (
    BulkApproveHighConfidence,
    BulkCategoryUpdate,
    BulkReviewUpdate,
    CategoryOut,
    RuleSuggestion,
    TransactionOut,
    TransactionUpdate,
)
from app.services.audit import AuditAction, write_audit
from app.services.categories import (
    assert_category_usable,
    category_to_out,
    resolve_category_by_slug,
)
from app.services.period_close import assert_not_locked_for_tx
from app.services.rules import build_rule_suggestion, normalize_pattern
from app.services.merchants import match_merchant

router = APIRouter(tags=["transactions"])


def _suggested_category(db: DbSession, tx: Transaction) -> Optional[CategoryOut]:
    raw = tx.raw_json if isinstance(tx.raw_json, dict) else None
    if not raw:
        return None
    slug = raw.get("category")
    if not slug or not isinstance(slug, str):
        return None
    cat = resolve_category_by_slug(db, tx.organization_id, slug)
    if not cat:
        return None
    # Don't echo "other" as a useful suggestion
    if cat.slug == "other":
        return None
    return category_to_out(cat)


def _tx_out(
    db: DbSession,
    tx: Transaction,
    *,
    rule_suggestion: Optional[dict[str, Any]] = None,
) -> TransactionOut:
    cat = category_to_out(tx.category) if tx.category else None
    suggested = _suggested_category(db, tx)
    suggestion = None
    if rule_suggestion:
        suggestion = RuleSuggestion(**rule_suggestion)
    return TransactionOut(
        id=tx.id,
        document_id=tx.document_id,
        transaction_date=tx.transaction_date.isoformat(),
        description=tx.description,
        debit=tx.debit,
        credit=tx.credit,
        balance=tx.balance,
        reference=tx.reference,
        category_id=tx.category_id,
        category=cat,
        confidence_score=tx.confidence_score,
        needs_review=tx.needs_review,
        page_number=tx.page_number,
        extraction_source=tx.extraction_source,
        source_meta=tx.source_meta_json,
        suggested_category=suggested,
        rule_suggestion=suggestion,
    )


@router.get("/transactions", response_model=list[TransactionOut])
def list_transactions(
    user: CurrentUser,
    db: DbSession,
    q: Optional[str] = None,
    category_id: Optional[UUID] = None,
    needs_review: Optional[bool] = None,
    document_id: Optional[UUID] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    sort: str = Query("date_desc", pattern="^(date_desc|date_asc|amount_desc|amount_asc|page_asc)$"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[TransactionOut]:
    query = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.organization_id == user.organization_id)
    )
    if q:
        query = query.filter(Transaction.description.ilike(f"%{q}%"))
    if category_id:
        query = query.filter(Transaction.category_id == category_id)
    if needs_review is not None:
        query = query.filter(Transaction.needs_review == needs_review)
    if document_id:
        query = query.filter(Transaction.document_id == document_id)
    if date_from:
        query = query.filter(Transaction.transaction_date >= date_from)
    if date_to:
        query = query.filter(Transaction.transaction_date <= date_to)

    amount_expr = sa_func.coalesce(Transaction.debit, 0) + sa_func.coalesce(
        Transaction.credit, 0
    )
    if sort == "date_asc":
        query = query.order_by(Transaction.transaction_date.asc())
    elif sort == "amount_desc":
        query = query.order_by(amount_expr.desc())
    elif sort == "amount_asc":
        query = query.order_by(amount_expr.asc())
    elif sort == "page_asc":
        query = query.order_by(
            Transaction.page_number.is_(None),
            Transaction.page_number.asc(),
            Transaction.transaction_date.asc(),
        )
    else:
        query = query.order_by(Transaction.transaction_date.desc())

    rows = query.offset(offset).limit(limit).all()
    return [_tx_out(db, t) for t in rows]


@router.patch("/transactions/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    transaction_id: UUID,
    payload: TransactionUpdate,
    user: CurrentUser,
    db: DbSession,
) -> TransactionOut:
    tx = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(
            Transaction.id == transaction_id,
            Transaction.organization_id == user.organization_id,
        )
        .first()
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    try:
        assert_not_locked_for_tx(db, user.organization_id, tx)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if payload.category_id is None and payload.needs_review is None:
        raise HTTPException(status_code=400, detail="Nothing to update")

    rule_suggestion: Optional[dict[str, Any]] = None

    if payload.category_id is not None:
        try:
            category = assert_category_usable(db, user.organization_id, payload.category_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        previous_id = tx.category_id
        previous_review = tx.needs_review
        tx.category_id = category.id
        tx.needs_review = False
        # Opt-in learning — suggest merchant + category rule
        if previous_id != category.id:
            existing_merchant = match_merchant(
                db, user.organization_id, tx.description
            )
            merchant_label = (
                existing_merchant.name
                if existing_merchant
                else normalize_pattern(tx.description).title()
            )
            rule_suggestion = build_rule_suggestion(
                description=tx.description,
                category=category,
                merchant_name=merchant_label or None,
            )
            if existing_merchant and existing_merchant.category_id != category.id:
                # Point merchant at the corrected category when user confirms learn
                pass
            tx.merchant_id = existing_merchant.id if existing_merchant else tx.merchant_id
        write_audit(
            db,
            organization_id=user.organization_id,
            user_id=user.id,
            client_id=tx.client_id,
            action=AuditAction.TRANSACTION_CATEGORY_CHANGED,
            entity_type="transaction",
            entity_id=str(tx.id),
            before={
                "category_id": str(previous_id) if previous_id else None,
                "needs_review": previous_review,
            },
            after={
                "category_id": str(category.id),
                "needs_review": False,
            },
        )
    elif payload.needs_review is not None:
        previous_review = tx.needs_review
        tx.needs_review = payload.needs_review
        if previous_review and not payload.needs_review:
            write_audit(
                db,
                organization_id=user.organization_id,
                user_id=user.id,
                client_id=tx.client_id,
                action=AuditAction.TRANSACTION_REVIEW_CLEARED,
                entity_type="transaction",
                entity_id=str(tx.id),
                before={"needs_review": True},
                after={"needs_review": False},
            )

    db.commit()
    db.refresh(tx)
    if tx.category_id and not tx.category:
        db.refresh(tx, attribute_names=["category"])
    # Ensure category relationship loaded
    tx = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.id == tx.id)
        .first()
    )
    assert tx is not None
    return _tx_out(db, tx, rule_suggestion=rule_suggestion)


@router.post("/transactions/bulk-category", response_model=list[TransactionOut])
def bulk_update_category(
    payload: BulkCategoryUpdate,
    user: CurrentUser,
    db: DbSession,
) -> list[TransactionOut]:
    try:
        category = assert_category_usable(db, user.organization_id, payload.category_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    txs = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(
            Transaction.organization_id == user.organization_id,
            Transaction.id.in_(payload.transaction_ids),
        )
        .all()
    )
    for tx in txs:
        try:
            assert_not_locked_for_tx(db, user.organization_id, tx)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        tx.category_id = category.id
        tx.needs_review = False
        # Skip per-row learning rules on bulk (teach from a single edit instead)

    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action=AuditAction.TRANSACTION_BULK,
        entity_type="transaction",
        entity_id=None,
        after={"category_id": str(category.id), "count": len(txs)},
        meta={
            "bulk_kind": "category",
            "transaction_ids": [str(t.id) for t in txs],
            "client_ids": sorted({str(t.client_id) for t in txs if t.client_id}),
        },
    )
    db.commit()
    txs = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.id.in_([t.id for t in txs]))
        .all()
    )
    return [_tx_out(db, t) for t in txs]


@router.post("/transactions/bulk-review", response_model=list[TransactionOut])
def bulk_update_review(
    payload: BulkReviewUpdate,
    user: CurrentUser,
    db: DbSession,
) -> list[TransactionOut]:
    txs = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(
            Transaction.organization_id == user.organization_id,
            Transaction.id.in_(payload.transaction_ids),
        )
        .all()
    )
    for tx in txs:
        try:
            assert_not_locked_for_tx(db, user.organization_id, tx)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        tx.needs_review = payload.needs_review

    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action=AuditAction.TRANSACTION_BULK,
        entity_type="transaction",
        entity_id=None,
        after={"needs_review": payload.needs_review, "count": len(txs)},
        meta={
            "bulk_kind": "review_clear" if not payload.needs_review else "review_flag",
            "transaction_ids": [str(t.id) for t in txs],
        },
    )
    db.commit()
    for tx in txs:
        db.refresh(tx)
    return [_tx_out(db, t) for t in txs]


@router.post(
    "/transactions/bulk-approve-high-confidence",
    response_model=list[TransactionOut],
)
def bulk_approve_high_confidence(
    payload: BulkApproveHighConfidence,
    user: CurrentUser,
    db: DbSession,
) -> list[TransactionOut]:
    settings = get_settings()
    threshold = (
        payload.min_confidence
        if payload.min_confidence is not None
        else settings.confidence_review_threshold
    )
    query = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(
            Transaction.organization_id == user.organization_id,
            Transaction.needs_review.is_(True),
            Transaction.confidence_score.isnot(None),
            Transaction.confidence_score >= Decimal(str(threshold)),
        )
    )
    if payload.document_id:
        query = query.filter(Transaction.document_id == payload.document_id)
    if payload.transaction_ids:
        query = query.filter(Transaction.id.in_(payload.transaction_ids))

    txs = query.limit(500).all()
    updated: list[Transaction] = []
    for tx in txs:
        try:
            assert_not_locked_for_tx(db, user.organization_id, tx)
        except ValueError:
            continue
        tx.needs_review = False
        updated.append(tx)

    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action=AuditAction.TRANSACTION_BULK,
        entity_type="transaction",
        entity_id=None,
        after={"needs_review": False, "count": len(updated)},
        meta={
            "bulk_kind": "approve_high_confidence",
            "min_confidence": threshold,
            "document_id": str(payload.document_id) if payload.document_id else None,
            "transaction_ids": [str(t.id) for t in updated],
        },
    )
    db.commit()
    if not updated:
        return []
    ids = [t.id for t in updated]
    refreshed = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.id.in_(ids))
        .all()
    )
    return [_tx_out(db, t) for t in refreshed]
