from __future__ import annotations

from enum import Enum
from typing import TYPE_CHECKING, Optional
from uuid import UUID

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.db.types import GUID
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.organization import Organization


class CategoryType(str, Enum):
    INCOME = "income"
    EXPENSE = "expense"


class Category(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="uq_category_org_slug"),
    )

    organization_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("organizations.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    type: Mapped[CategoryType] = mapped_column(
        SAEnum(CategoryType, name="category_type", values_callable=lambda x: [e.value for e in x], native_enum=False),
        nullable=False,
    )

    organization: Mapped[Optional[Organization]] = relationship()
