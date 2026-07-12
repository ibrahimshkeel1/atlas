from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Optional
from uuid import UUID

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.db.types import GUID, JSONType
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.category import Category
    from app.models.client import Client
    from app.models.document import Document
    from app.models.merchant import Merchant
    from app.models.organization import Organization


class Transaction(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_transactions_org_date", "organization_id", "transaction_date"),
        Index("ix_transactions_org_category", "organization_id", "category_id"),
        Index("ix_transactions_document_id", "document_id"),
        Index("ix_transactions_org_client", "organization_id", "client_id"),
    )

    organization_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), nullable=False, index=True
    )
    client_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("clients.id"), nullable=True, index=True
    )
    document_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("documents.id"), nullable=False, index=True
    )
    bank_account_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("bank_accounts.id"), nullable=True, index=True
    )
    category_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("categories.id"), nullable=True, index=True
    )
    merchant_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("merchants.id"), nullable=True, index=True
    )
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    debit: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    credit: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    balance: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    reference: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    confidence_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 4), nullable=True)
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    raw_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType(), nullable=True)
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    extraction_source: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    source_meta_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType(), nullable=True)

    organization: Mapped[Organization] = relationship()
    client: Mapped[Optional[Client]] = relationship()
    document: Mapped[Document] = relationship()
    category: Mapped[Optional[Category]] = relationship()
    merchant: Mapped[Optional[Merchant]] = relationship()
