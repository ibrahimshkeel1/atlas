from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.deps import CurrentUser, DbSession
from app.models.client import Client
from app.services.audit import (
    KNOWN_ACTIONS,
    list_audit_logs,
    list_org_users_for_filter,
    serialize_audit,
)
from app.services.clients import get_default_client

router = APIRouter(prefix="/audit-logs", tags=["audit"])


@router.get("/filters")
def audit_filter_options(user: CurrentUser, db: DbSession) -> dict:
    clients = (
        db.query(Client)
        .filter(Client.organization_id == user.organization_id)
        .order_by(Client.name.asc())
        .all()
    )
    default = get_default_client(db, user.organization_id)
    return {
        "actions": KNOWN_ACTIONS,
        "users": list_org_users_for_filter(db, user.organization_id),
        "clients": [
            {
                "id": str(c.id),
                "name": c.name,
                "slug": c.slug,
                "is_default": c.is_default,
            }
            for c in clients
        ],
        "default_client_id": str(default.id) if default else None,
    }


@router.get("")
def get_audit_logs(
    user: CurrentUser,
    db: DbSession,
    user_id: Optional[UUID] = None,
    action: Optional[str] = None,
    client_id: Optional[UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    rows, total = list_audit_logs(
        db,
        organization_id=user.organization_id,
        user_id=user_id,
        action=action,
        client_id=client_id,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [serialize_audit(r) for r in rows],
    }
