"""Clients foundation for future CA firm multi-books support.

Revision ID: 006_clients
Revises: 005_eval_runs
Create Date: 2026-07-12

Organization remains the auth/security boundary.
Client is an SME under the firm. client_id is nullable so existing
workflows keep working; upgrade backfills a default client per org.
Downgrade drops FKs/columns/table (reversible).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006_clients"
down_revision: Union[str, None] = "005_eval_runs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Tenant tables that receive nullable client_id
_CLIENT_SCOPED_TABLES = (
    "bank_accounts",
    "documents",
    "transactions",
    "category_rules",
    "reports",
    "period_closes",
    "audit_logs",
)


def upgrade() -> None:
    op.create_table(
        "clients",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "slug", name="uq_client_org_slug"),
    )
    op.create_index("ix_clients_organization_id", "clients", ["organization_id"])
    op.create_index("ix_clients_is_default", "clients", ["organization_id", "is_default"])

    for table in _CLIENT_SCOPED_TABLES:
        op.add_column(table, sa.Column("client_id", sa.Uuid(), nullable=True))
        op.create_index(f"ix_{table}_client_id", table, ["client_id"])
        op.create_index(f"ix_{table}_org_client", table, ["organization_id", "client_id"])
        op.create_foreign_key(
            f"fk_{table}_client_id",
            table,
            "clients",
            ["client_id"],
            ["id"],
            ondelete="RESTRICT",
        )

    # Merchants already had client_id without FK — attach FK now
    op.create_foreign_key(
        "fk_merchants_client_id",
        "merchants",
        "clients",
        ["client_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_merchant_aliases_client_id",
        "merchant_aliases",
        "clients",
        ["client_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    # Data backfill (default client per org + set client_id)
    conn = op.get_bind()
    orgs = conn.execute(sa.text("SELECT id, name FROM organizations")).fetchall()
    for org_id, org_name in orgs:
        client_id = conn.execute(
            sa.text(
                """
                SELECT id FROM clients
                WHERE organization_id = :oid AND is_default = true
                LIMIT 1
                """
            ),
            {"oid": org_id},
        ).scalar()
        if not client_id:
            client_id = conn.execute(
                sa.text(
                    """
                    SELECT id FROM clients
                    WHERE organization_id = :oid AND slug = 'default'
                    LIMIT 1
                    """
                ),
                {"oid": org_id},
            ).scalar()
        if not client_id:
            import uuid
            from datetime import datetime, timezone

            client_id = uuid.uuid4()
            now = datetime.now(timezone.utc)
            conn.execute(
                sa.text(
                    """
                    INSERT INTO clients (
                        id, organization_id, name, slug, status, is_default, notes,
                        created_at, updated_at
                    ) VALUES (
                        :id, :oid, :name, 'default', 'active', true,
                        'Auto-created default client for pre-multi-client data',
                        :now, :now
                    )
                    """
                ),
                {
                    "id": client_id,
                    "oid": org_id,
                    "name": org_name or "Default client",
                    "now": now,
                },
            )

        for table in _CLIENT_SCOPED_TABLES:
            conn.execute(
                sa.text(
                    f"""
                    UPDATE {table}
                    SET client_id = :cid
                    WHERE organization_id = :oid AND client_id IS NULL
                    """
                ),
                {"cid": client_id, "oid": org_id},
            )
        for table in ("merchants", "merchant_aliases"):
            conn.execute(
                sa.text(
                    f"""
                    UPDATE {table}
                    SET client_id = :cid
                    WHERE organization_id = :oid AND client_id IS NULL
                    """
                ),
                {"cid": client_id, "oid": org_id},
            )


def downgrade() -> None:
    op.drop_constraint("fk_merchant_aliases_client_id", "merchant_aliases", type_="foreignkey")
    op.drop_constraint("fk_merchants_client_id", "merchants", type_="foreignkey")

    for table in reversed(_CLIENT_SCOPED_TABLES):
        op.drop_constraint(f"fk_{table}_client_id", table, type_="foreignkey")
        op.drop_index(f"ix_{table}_org_client", table_name=table)
        op.drop_index(f"ix_{table}_client_id", table_name=table)
        op.drop_column(table, "client_id")

    # Leave merchant client_id columns in place (pre-existed); only FKs removed above.
    op.drop_index("ix_clients_is_default", table_name="clients")
    op.drop_index("ix_clients_organization_id", table_name="clients")
    op.drop_table("clients")
