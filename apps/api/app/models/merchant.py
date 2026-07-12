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


class MerchantAliasMatchType(str, Enum):
    CONTAINS = "contains"
    EXACT = "exact"
    PREFIX = "prefix"


class MerchantAliasSource(str, Enum):
    SYSTEM = "system"
    USER = "user"
    LEARNED = "learned"


class Merchant(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Canonical merchant (e.g. Shell). organization_id NULL = system-wide."""

    __tablename__ = "merchants"
    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="uq_merchant_org_slug"),
    )

    organization_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("organizations.id"), nullable=True, index=True
    )
    client_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("clients.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    category_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("categories.id"), nullable=True, index=True
    )

    organization: Mapped[Optional[Organization]] = relationship()
    client: Mapped[Optional[Client]] = relationship()
    category: Mapped[Optional[Category]] = relationship()
    aliases: Mapped[list["MerchantAlias"]] = relationship(
        back_populates="merchant", cascade="all, delete-orphan"
    )


class MerchantAlias(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Alias / pattern that maps a description fragment to a merchant."""

    __tablename__ = "merchant_aliases"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "pattern",
            "match_type",
            name="uq_merchant_alias_org_pattern",
        ),
    )

    merchant_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organization_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("organizations.id"), nullable=True, index=True
    )
    client_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("clients.id"), nullable=True, index=True
    )
    pattern: Mapped[str] = mapped_column(String(512), nullable=False)
    match_type: Mapped[MerchantAliasMatchType] = mapped_column(
        SAEnum(
            MerchantAliasMatchType,
            name="merchant_alias_match_type",
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
        ),
        nullable=False,
        default=MerchantAliasMatchType.CONTAINS,
    )
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    source: Mapped[MerchantAliasSource] = mapped_column(
        SAEnum(
            MerchantAliasSource,
            name="merchant_alias_source",
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
        ),
        nullable=False,
        default=MerchantAliasSource.USER,
    )

    merchant: Mapped[Merchant] = relationship(back_populates="aliases")
    organization: Mapped[Optional[Organization]] = relationship()
    client: Mapped[Optional[Client]] = relationship()
