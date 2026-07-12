from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING, Optional
from uuid import UUID

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.db.types import GUID
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.client import Client
    from app.models.organization import Organization
    from app.models.user import User


class PeriodClose(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Locks a month (or custom period) after review — blocks category edits / re-export chaos."""

    __tablename__ = "period_closes"
    __table_args__ = (
        UniqueConstraint("organization_id", "period_key", name="uq_period_close_org_key"),
    )

    organization_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), nullable=False, index=True
    )
    client_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("clients.id"), nullable=True, index=True
    )
    period_key: Mapped[str] = mapped_column(String(16), nullable=False)  # YYYY-MM
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    locked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    locked_by_user_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("users.id"), nullable=True
    )

    organization: Mapped[Organization] = relationship()
    client: Mapped[Optional[Client]] = relationship()
    locked_by: Mapped[Optional[User]] = relationship()
