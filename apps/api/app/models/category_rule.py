from __future__ import annotations

from enum import Enum
from typing import TYPE_CHECKING, Optional
from uuid import UUID

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.db.types import GUID
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.category import Category
    from app.models.client import Client
    from app.models.organization import Organization


class MatchType(str, Enum):
    CONTAINS = "contains"
    EXACT = "exact"


class CategoryRule(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "category_rules"
    __table_args__ = (
        UniqueConstraint("organization_id", "pattern", "match_type", name="uq_rule_org_pattern"),
    )

    organization_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), nullable=False, index=True
    )
    client_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("clients.id"), nullable=True, index=True
    )
    match_type: Mapped[MatchType] = mapped_column(
        SAEnum(MatchType, name="match_type", values_callable=lambda x: [e.value for e in x], native_enum=False),
        nullable=False,
        default=MatchType.CONTAINS,
    )
    pattern: Mapped[str] = mapped_column(String(512), nullable=False)
    category_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("categories.id"), nullable=False, index=True
    )
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)

    organization: Mapped[Organization] = relationship()
    client: Mapped[Optional["Client"]] = relationship()
    category: Mapped[Category] = relationship()
