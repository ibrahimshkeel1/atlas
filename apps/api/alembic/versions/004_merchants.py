"""Merchants + aliases for deterministic categorization.

Revision ID: 004_merchants
Revises: 003_tx_source_refs
Create Date: 2026-07-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004_merchants"
down_revision: Union[str, None] = "003_tx_source_refs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "merchants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("client_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "slug", name="uq_merchant_org_slug"),
    )
    op.create_index("ix_merchants_organization_id", "merchants", ["organization_id"])
    op.create_index("ix_merchants_client_id", "merchants", ["client_id"])
    op.create_index("ix_merchants_slug", "merchants", ["slug"])
    op.create_index("ix_merchants_category_id", "merchants", ["category_id"])

    op.create_table(
        "merchant_aliases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("merchant_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("client_id", sa.Uuid(), nullable=True),
        sa.Column("pattern", sa.String(length=512), nullable=False),
        sa.Column("match_type", sa.String(length=32), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["merchant_id"], ["merchants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "pattern",
            "match_type",
            name="uq_merchant_alias_org_pattern",
        ),
    )
    op.create_index("ix_merchant_aliases_merchant_id", "merchant_aliases", ["merchant_id"])
    op.create_index(
        "ix_merchant_aliases_organization_id", "merchant_aliases", ["organization_id"]
    )
    op.create_index("ix_merchant_aliases_client_id", "merchant_aliases", ["client_id"])

    op.add_column("transactions", sa.Column("merchant_id", sa.Uuid(), nullable=True))
    op.create_index("ix_transactions_merchant_id", "transactions", ["merchant_id"])
    op.create_foreign_key(
        "fk_transactions_merchant_id",
        "transactions",
        "merchants",
        ["merchant_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_transactions_merchant_id", "transactions", type_="foreignkey")
    op.drop_index("ix_transactions_merchant_id", table_name="transactions")
    op.drop_column("transactions", "merchant_id")
    op.drop_table("merchant_aliases")
    op.drop_table("merchants")
