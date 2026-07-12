"""Internal extraction evaluation runs.

Revision ID: 005_eval_runs
Revises: 004_merchants
Create Date: 2026-07-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005_eval_runs"
down_revision: Union[str, None] = "004_merchants"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "eval_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("triggered_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("statements_tested", sa.Integer(), nullable=False),
        sa.Column("transaction_recall", sa.Float(), nullable=True),
        sa.Column("missing_rows", sa.Integer(), nullable=False),
        sa.Column("wrong_amounts", sa.Integer(), nullable=False),
        sa.Column("wrong_dates", sa.Integer(), nullable=False),
        sa.Column("category_accuracy", sa.Float(), nullable=True),
        sa.Column("other_percentage", sa.Float(), nullable=True),
        sa.Column("review_percentage", sa.Float(), nullable=True),
        sa.Column("categorization_fixture_count", sa.Integer(), nullable=False),
        sa.Column("balance_matches", sa.Integer(), nullable=False),
        sa.Column("balance_mismatches", sa.Integer(), nullable=False),
        sa.Column("balance_unknown", sa.Integer(), nullable=False),
        sa.Column("ocr_usage_count", sa.Integer(), nullable=False),
        sa.Column("ai_fallback_count", sa.Integer(), nullable=False),
        sa.Column("failure_count", sa.Integer(), nullable=False),
        sa.Column("parser_counts_json", sa.JSON(), nullable=True),
        sa.Column("summary_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["triggered_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_eval_runs_triggered_by_user_id", "eval_runs", ["triggered_by_user_id"])
    op.create_index("ix_eval_runs_created_at", "eval_runs", ["created_at"])

    op.create_table(
        "eval_fixture_results",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("eval_run_id", sa.Uuid(), nullable=False),
        sa.Column("fixture_name", sa.String(length=128), nullable=False),
        sa.Column("expected_bank", sa.String(length=128), nullable=True),
        sa.Column("predicted_bank", sa.String(length=128), nullable=True),
        sa.Column("bank_ok", sa.Boolean(), nullable=False),
        sa.Column("expected_count", sa.Integer(), nullable=False),
        sa.Column("predicted_count", sa.Integer(), nullable=False),
        sa.Column("matched", sa.Integer(), nullable=False),
        sa.Column("missing_rows", sa.Integer(), nullable=False),
        sa.Column("wrong_amounts", sa.Integer(), nullable=False),
        sa.Column("wrong_dates", sa.Integer(), nullable=False),
        sa.Column("recall", sa.Float(), nullable=True),
        sa.Column("precision", sa.Float(), nullable=True),
        sa.Column("f1", sa.Float(), nullable=True),
        sa.Column("balance_tie_out", sa.String(length=32), nullable=False),
        sa.Column("stated_closing", sa.Float(), nullable=True),
        sa.Column("ledger_closing", sa.Float(), nullable=True),
        sa.Column("used_ocr", sa.Boolean(), nullable=False),
        sa.Column("ai_fallback", sa.Boolean(), nullable=False),
        sa.Column("parser_used", sa.String(length=128), nullable=True),
        sa.Column("failed", sa.Boolean(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("detail_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["eval_run_id"], ["eval_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_eval_fixture_results_eval_run_id", "eval_fixture_results", ["eval_run_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_eval_fixture_results_eval_run_id", table_name="eval_fixture_results")
    op.drop_table("eval_fixture_results")
    op.drop_index("ix_eval_runs_created_at", table_name="eval_runs")
    op.drop_index("ix_eval_runs_triggered_by_user_id", table_name="eval_runs")
    op.drop_table("eval_runs")
