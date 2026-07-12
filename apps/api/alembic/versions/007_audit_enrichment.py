"""Enrich audit_logs for CA-firm working papers trail.

Revision ID: 007_audit_enrichment
Revises: 006_clients
Create Date: 2026-07-12

Adds before/after payloads, IP, and user-agent. Append-only — no deletes.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007_audit_enrichment"
down_revision: Union[str, None] = "006_clients"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("before_json", sa.JSON(), nullable=True))
    op.add_column("audit_logs", sa.Column("after_json", sa.JSON(), nullable=True))
    op.add_column("audit_logs", sa.Column("ip_address", sa.String(length=64), nullable=True))
    op.add_column("audit_logs", sa.Column("user_agent", sa.String(length=512), nullable=True))
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index(
        "ix_audit_logs_org_action_created",
        "audit_logs",
        ["organization_id", "action", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_logs_org_action_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_user_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_column("audit_logs", "user_agent")
    op.drop_column("audit_logs", "ip_address")
    op.drop_column("audit_logs", "after_json")
    op.drop_column("audit_logs", "before_json")
