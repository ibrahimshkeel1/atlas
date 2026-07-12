from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional
from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.db.types import GUID, JSONType
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.client import Client
    from app.models.organization import Organization
    from app.models.user import User


class AuditLog(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Append-only activity trail for CA firm accountability.

    Rows are inserted only — never updated or deleted by application code.
    """

    __tablename__ = "audit_logs"

    organization_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), nullable=False, index=True
    )
    client_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("clients.id"), nullable=True, index=True
    )
    user_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("users.id"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(128), nullable=False)
    entity_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    before_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType(), nullable=True)
    after_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType(), nullable=True)
    meta_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType(), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    organization: Mapped[Organization] = relationship()
    client: Mapped[Optional[Client]] = relationship()
    user: Mapped[Optional[User]] = relationship()
