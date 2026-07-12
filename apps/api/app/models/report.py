from __future__ import annotations

from datetime import date
from enum import Enum
from typing import TYPE_CHECKING, Any, Optional
from uuid import UUID

from sqlalchemy import Date, Enum as SAEnum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.db.types import GUID, JSONType
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.client import Client
    from app.models.organization import Organization


class ReportType(str, Enum):
    MONTHLY_INCOME = "monthly_income"
    EXPENSE_BREAKDOWN = "expense_breakdown"
    CASH_FLOW = "cash_flow"
    TAX_SUMMARY = "tax_summary"


class ReportStatus(str, Enum):
    PENDING = "pending"
    READY = "ready"
    FAILED = "failed"


class Report(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "reports"

    organization_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), nullable=False, index=True
    )
    client_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("clients.id"), nullable=True, index=True
    )
    type: Mapped[ReportType] = mapped_column(
        SAEnum(ReportType, name="report_type", values_callable=lambda x: [e.value for e in x], native_enum=False),
        nullable=False,
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    s3_key: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    status: Mapped[ReportStatus] = mapped_column(
        SAEnum(ReportStatus, name="report_status", values_callable=lambda x: [e.value for e in x], native_enum=False),
        nullable=False,
        default=ReportStatus.PENDING,
    )
    params_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType(), nullable=True)
    format: Mapped[str] = mapped_column(String(16), nullable=False, default="xlsx")

    organization: Mapped[Organization] = relationship()
    client: Mapped[Optional[Client]] = relationship()
