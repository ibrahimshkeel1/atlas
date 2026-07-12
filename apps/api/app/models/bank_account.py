from __future__ import annotations

from typing import TYPE_CHECKING, Optional
from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.db.types import GUID
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.client import Client
    from app.models.organization import Organization


class BankAccount(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "bank_accounts"

    organization_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), nullable=False, index=True
    )
    client_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("clients.id"), nullable=True, index=True
    )
    bank_name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_last4: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="PKR")

    organization: Mapped[Organization] = relationship()
    client: Mapped[Optional[Client]] = relationship()
