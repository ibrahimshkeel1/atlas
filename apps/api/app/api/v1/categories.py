from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.core.deps import CurrentUser, DbSession
from app.models.category import CategoryType
from app.schemas import CategoryCreate, CategoryOut, CategoryUpdate
from app.services.auth import write_audit
from app.services.categories import (
    category_to_out,
    create_org_category,
    delete_org_category,
    list_categories_for_org,
    update_org_category,
)

router = APIRouter(tags=["categories"])


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(user: CurrentUser, db: DbSession) -> list[CategoryOut]:
    cats = list_categories_for_org(db, user.organization_id)
    return [category_to_out(c) for c in cats]


@router.post("/categories", response_model=CategoryOut)
def create_category(
    payload: CategoryCreate, user: CurrentUser, db: DbSession
) -> CategoryOut:
    try:
        ctype = CategoryType(payload.type.strip().lower())
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="Type must be income or expense"
        ) from exc
    try:
        cat = create_org_category(
            db,
            organization_id=user.organization_id,
            name=payload.name,
            category_type=ctype,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="category.create",
        entity_type="category",
        entity_id=str(cat.id),
        meta={"name": cat.name, "type": cat.type.value},
    )
    db.commit()
    db.refresh(cat)
    return category_to_out(cat)


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def patch_category(
    category_id: UUID,
    payload: CategoryUpdate,
    user: CurrentUser,
    db: DbSession,
) -> CategoryOut:
    ctype = None
    if payload.type is not None:
        try:
            ctype = CategoryType(payload.type.strip().lower())
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="Type must be income or expense"
            ) from exc
    try:
        cat = update_org_category(
            db,
            organization_id=user.organization_id,
            category_id=category_id,
            name=payload.name,
            category_type=ctype,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="category.update",
        entity_type="category",
        entity_id=str(cat.id),
        meta={"name": cat.name, "type": cat.type.value},
    )
    db.commit()
    db.refresh(cat)
    return category_to_out(cat)


@router.delete("/categories/{category_id}")
def remove_category(
    category_id: UUID,
    user: CurrentUser,
    db: DbSession,
    reassign_to_id: Optional[UUID] = None,
) -> dict:
    try:
        delete_org_category(
            db,
            organization_id=user.organization_id,
            category_id=category_id,
            reassign_to_id=reassign_to_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="category.delete",
        entity_type="category",
        entity_id=str(category_id),
        meta={"reassign_to_id": str(reassign_to_id) if reassign_to_id else None},
    )
    db.commit()
    return {"ok": True}
