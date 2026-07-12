"""Append-only audit logging for Atlas (CA firm readiness)."""

from __future__ import annotations

from contextvars import ContextVar
from datetime import date, datetime
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models.audit_log import AuditLog
from app.models.user import User

# Request-scoped extras (set by FastAPI dependency)
_audit_ip: ContextVar[Optional[str]] = ContextVar("audit_ip", default=None)
_audit_ua: ContextVar[Optional[str]] = ContextVar("audit_ua", default=None)


class AuditAction:
    AUTH_LOGIN = "auth.login"
    AUTH_LOGIN_FAILED = "auth.login_failed"
    AUTH_LOGOUT = "auth.logout"
    AUTH_SIGNUP = "auth.signup"

    DOCUMENT_UPLOAD = "document.upload"
    DOCUMENT_EXTRACTION_COMPLETED = "document.extraction_completed"
    DOCUMENT_REPROCESS = "document.reprocess"
    DOCUMENT_DELETE = "document.delete"

    TRANSACTION_CATEGORY_CHANGED = "transaction.category_changed"
    TRANSACTION_REVIEW_CLEARED = "transaction.review_cleared"
    TRANSACTION_BULK = "transaction.bulk_action"

    REPORT_EXPORT = "report.export"
    REPORT_EXPORT_FORCED = "report.export_forced"

    PERIOD_LOCK = "period.lock"
    PERIOD_UNLOCK = "period.unlock"


SENSITIVE_ACTIONS = {
    AuditAction.AUTH_LOGIN,
    AuditAction.AUTH_LOGIN_FAILED,
    AuditAction.AUTH_LOGOUT,
    AuditAction.AUTH_SIGNUP,
    AuditAction.REPORT_EXPORT,
    AuditAction.REPORT_EXPORT_FORCED,
    AuditAction.PERIOD_LOCK,
    AuditAction.PERIOD_UNLOCK,
    AuditAction.DOCUMENT_DELETE,
}


def set_request_audit_context(*, ip_address: str | None, user_agent: str | None) -> None:
    _audit_ip.set((ip_address or "")[:64] or None)
    _audit_ua.set((user_agent or "")[:512] or None)


def clear_request_audit_context() -> None:
    _audit_ip.set(None)
    _audit_ua.set(None)


def _jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def write_audit(
    db: Session,
    *,
    organization_id: UUID,
    action: str,
    entity_type: str,
    user_id: UUID | None = None,
    entity_id: str | None = None,
    client_id: UUID | None = None,
    before: dict | None = None,
    after: dict | None = None,
    meta: dict | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> AuditLog:
    """
    Insert an audit row. Never updates or deletes existing rows.
    IP / user-agent auto-filled from request context for sensitive actions.
    """
    if action in SENSITIVE_ACTIONS:
        ip = ip_address if ip_address is not None else _audit_ip.get()
        ua = user_agent if user_agent is not None else _audit_ua.get()
    else:
        ip = ip_address
        ua = user_agent

    row = AuditLog(
        organization_id=organization_id,
        client_id=client_id,
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        before_json=_jsonable(before) if before is not None else None,
        after_json=_jsonable(after) if after is not None else None,
        meta_json=_jsonable(meta) if meta is not None else None,
        ip_address=(ip or None),
        user_agent=(ua or None),
    )
    db.add(row)
    db.flush()
    return row


# Back-compat shim used by older call sites during transition
def write_audit_legacy(
    db: Session,
    *,
    organization_id: UUID,
    user_id: UUID | None,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    meta: dict | None = None,
    client_id: UUID | None = None,
) -> None:
    write_audit(
        db,
        organization_id=organization_id,
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        meta=meta,
        client_id=client_id,
    )


def serialize_audit(row: AuditLog) -> dict[str, Any]:
    user = row.user
    client = row.client
    return {
        "id": str(row.id),
        "organization_id": str(row.organization_id),
        "client_id": str(row.client_id) if row.client_id else None,
        "client_name": client.name if client else None,
        "user_id": str(row.user_id) if row.user_id else None,
        "user_name": user.full_name if user else None,
        "user_email": user.email if user else None,
        "action": row.action,
        "entity_type": row.entity_type,
        "entity_id": row.entity_id,
        "before": row.before_json,
        "after": row.after_json,
        "meta": row.meta_json,
        "ip_address": row.ip_address,
        "user_agent": row.user_agent,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def list_audit_logs(
    db: Session,
    *,
    organization_id: UUID,
    user_id: UUID | None = None,
    action: str | None = None,
    client_id: UUID | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[AuditLog], int]:
    q = (
        db.query(AuditLog)
        .options(joinedload(AuditLog.user), joinedload(AuditLog.client))
        .filter(AuditLog.organization_id == organization_id)
    )
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if action:
        q = q.filter(AuditLog.action == action)
    if client_id:
        q = q.filter(AuditLog.client_id == client_id)
    if date_from:
        q = q.filter(AuditLog.created_at >= date_from)
    if date_to:
        q = q.filter(AuditLog.created_at <= date_to)

    total = q.count()
    rows = (
        q.order_by(AuditLog.created_at.desc())
        .offset(offset)
        .limit(min(limit, 500))
        .all()
    )
    return rows, total


def list_org_users_for_filter(db: Session, organization_id: UUID) -> list[dict[str, str]]:
    users = (
        db.query(User)
        .filter(User.organization_id == organization_id)
        .order_by(User.full_name.asc())
        .all()
    )
    return [{"id": str(u.id), "name": u.full_name, "email": u.email} for u in users]


KNOWN_ACTIONS = [
    AuditAction.AUTH_LOGIN,
    AuditAction.AUTH_LOGIN_FAILED,
    AuditAction.AUTH_LOGOUT,
    AuditAction.AUTH_SIGNUP,
    AuditAction.DOCUMENT_UPLOAD,
    AuditAction.DOCUMENT_EXTRACTION_COMPLETED,
    AuditAction.DOCUMENT_REPROCESS,
    AuditAction.DOCUMENT_DELETE,
    AuditAction.TRANSACTION_CATEGORY_CHANGED,
    AuditAction.TRANSACTION_REVIEW_CLEARED,
    AuditAction.TRANSACTION_BULK,
    AuditAction.REPORT_EXPORT,
    AuditAction.REPORT_EXPORT_FORCED,
    AuditAction.PERIOD_LOCK,
    AuditAction.PERIOD_UNLOCK,
]
