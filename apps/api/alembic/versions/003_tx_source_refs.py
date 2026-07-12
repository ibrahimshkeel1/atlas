"""Add transaction PDF source references for side-by-side review.

Revision ID: 003_tx_source_refs
Revises: 002_extraction_meta
Create Date: 2026-07-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003_tx_source_refs"
down_revision: Union[str, None] = "002_extraction_meta"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column("page_number", sa.Integer(), nullable=True))
    op.add_column("transactions", sa.Column("extraction_source", sa.String(64), nullable=True))
    op.add_column("transactions", sa.Column("source_meta_json", sa.JSON(), nullable=True))
    # document_id already indexed via FK in most setups; skip duplicate index create


def downgrade() -> None:
    op.drop_column("transactions", "source_meta_json")
    op.drop_column("transactions", "extraction_source")
    op.drop_column("transactions", "page_number")
