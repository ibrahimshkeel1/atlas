from __future__ import annotations

from enum import Enum
from typing import TYPE_CHECKING, Optional
from uuid import UUID

from sqlalchemy import Boolean, Enum as SAEnum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.db.types import GUID
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.organization import Organization


class ClientStatus(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class Client(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    SME / books entity under an organization (future CA firm).

    Security boundary remains organization_id on users and queries.
    client_id scopes books data within a firm; nullable until multi-client UI ships.
    """

    __tablename__ = "clients"
    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="uq_client_org_slug"),
    )

    organization_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[ClientStatus] = mapped_column(
        SAEnum(
            ClientStatus,
            name="client_status",
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
        ),
        nullable=False,
        default=ClientStatus.ACTIVE,
    )
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    organization: Mapped[Organization] = relationship(back_populates="clients")
