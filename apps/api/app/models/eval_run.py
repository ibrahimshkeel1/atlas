from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional
from uuid import UUID

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.db.types import GUID, JSONType
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.user import User


class EvalRun(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Persisted internal extraction/categorization evaluation snapshot."""

    __tablename__ = "eval_runs"

    triggered_by_user_id: Mapped[Optional[UUID]] = mapped_column(
        GUID(), ForeignKey("users.id"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Extraction aggregates (measured from fixtures only)
    statements_tested: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    transaction_recall: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    missing_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_amounts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_dates: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Categorization aggregates (measured from categorization fixtures)
    category_accuracy: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    other_percentage: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    review_percentage: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    categorization_fixture_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Reconciliation
    balance_matches: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    balance_mismatches: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    balance_unknown: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Processing
    ocr_usage_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ai_fallback_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    parser_counts_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType(), nullable=True)
    summary_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType(), nullable=True)

    triggered_by: Mapped[Optional[User]] = relationship()
    fixture_results: Mapped[list[EvalFixtureResult]] = relationship(
        back_populates="eval_run",
        cascade="all, delete-orphan",
        order_by="EvalFixtureResult.fixture_name",
    )


class EvalFixtureResult(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Per-statement fixture measurements for one eval run."""

    __tablename__ = "eval_fixture_results"

    eval_run_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    fixture_name: Mapped[str] = mapped_column(String(128), nullable=False)
    expected_bank: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    predicted_bank: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    bank_ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    expected_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    predicted_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    matched: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    missing_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_amounts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_dates: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    recall: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    precision: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    f1: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    balance_tie_out: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    stated_closing: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ledger_closing: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    used_ocr: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ai_fallback: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    parser_used: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    failed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    detail_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType(), nullable=True)

    eval_run: Mapped[EvalRun] = relationship(back_populates="fixture_results")
