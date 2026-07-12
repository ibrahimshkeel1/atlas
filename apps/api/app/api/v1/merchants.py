from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import joinedload

from app.core.deps import CurrentUser, DbSession
from app.models.merchant import Merchant
from app.schemas import (
    MerchantAliasOut,
    MerchantCreate,
    MerchantLearnRequest,
    MerchantOut,
)
from app.services.auth import write_audit
from app.services.categories import assert_category_usable, category_to_out
from app.services.merchants import (
    create_org_merchant,
    learn_merchant_from_correction,
    list_merchants_for_org,
    seed_system_merchants,
)
from app.services.rules import upsert_rule

router = APIRouter(tags=["merchants"])


def _merchant_out(m: Merchant) -> MerchantOut:
    cat = category_to_out(m.category) if m.category else None
    return MerchantOut(
        id=m.id,
        name=m.name,
        slug=m.slug,
        category_id=m.category_id,
        category=cat,
        is_system=m.organization_id is None,
        client_id=m.client_id,
        aliases=[
            MerchantAliasOut(
                id=a.id,
                pattern=a.pattern,
                match_type=a.match_type.value if hasattr(a.match_type, "value") else str(a.match_type),
                priority=a.priority,
                source=a.source.value if hasattr(a.source, "value") else str(a.source),
            )
            for a in (m.aliases or [])
        ],
    )


@router.get("/merchants", response_model=list[MerchantOut])
def list_merchants(user: CurrentUser, db: DbSession) -> list[MerchantOut]:
    seed_system_merchants(db)
    db.commit()
    merchants = list_merchants_for_org(db, user.organization_id)
    return [_merchant_out(m) for m in merchants]


@router.post("/merchants", response_model=MerchantOut)
def create_merchant(
    payload: MerchantCreate, user: CurrentUser, db: DbSession
) -> MerchantOut:
    category_id = payload.category_id
    if category_id is not None:
        try:
            assert_category_usable(db, user.organization_id, category_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        merchant = create_org_merchant(
            db,
            organization_id=user.organization_id,
            name=payload.name,
            category_id=category_id,
            aliases=payload.aliases,
            client_id=payload.client_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="merchant.create",
        entity_type="merchant",
        entity_id=str(merchant.id),
        meta={"name": merchant.name},
    )
    db.commit()
    merchant = (
        db.query(Merchant)
        .options(joinedload(Merchant.category), joinedload(Merchant.aliases))
        .filter(Merchant.id == merchant.id)
        .first()
    )
    assert merchant is not None
    return _merchant_out(merchant)


@router.post("/merchants/learn", response_model=MerchantOut)
def learn_merchant(
    payload: MerchantLearnRequest, user: CurrentUser, db: DbSession
) -> MerchantOut:
    """Learn a merchant alias (+ optional category rule) from a correction."""
    try:
        assert_category_usable(db, user.organization_id, payload.category_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        merchant, _alias, meta = learn_merchant_from_correction(
            db,
            organization_id=user.organization_id,
            description=payload.description,
            category_id=payload.category_id,
            merchant_name=payload.merchant_name,
            client_id=payload.client_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if payload.also_create_category_rule:
        upsert_rule(
            db,
            organization_id=user.organization_id,
            description=payload.description,
            category_id=payload.category_id,
        )

    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="merchant.learn",
        entity_type="merchant",
        entity_id=str(merchant.id),
        meta=meta,
    )
    db.commit()
    merchant = (
        db.query(Merchant)
        .options(joinedload(Merchant.category), joinedload(Merchant.aliases))
        .filter(Merchant.id == merchant.id)
        .first()
    )
    assert merchant is not None
    return _merchant_out(merchant)


@router.delete("/merchants/{merchant_id}")
def delete_merchant(
    merchant_id: UUID, user: CurrentUser, db: DbSession
) -> dict:
    merchant = db.get(Merchant, merchant_id)
    if not merchant or merchant.organization_id != user.organization_id:
        raise HTTPException(status_code=400, detail="Custom merchant not found")
    db.delete(merchant)
    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="merchant.delete",
        entity_type="merchant",
        entity_id=str(merchant_id),
        meta={},
    )
    db.commit()
    return {"ok": True}
