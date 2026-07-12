"""Client foundation helpers (CA firm → SME books).

Does not change auth: users stay scoped by organization_id only.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.client import Client, ClientStatus
from app.models.organization import Organization

DEFAULT_CLIENT_SLUG = "default"


def get_default_client(db: Session, organization_id: UUID) -> Client | None:
    return (
        db.query(Client)
        .filter(
            Client.organization_id == organization_id,
            Client.is_default.is_(True),
        )
        .order_by(Client.created_at.asc())
        .first()
    )


def ensure_default_client(db: Session, organization_id: UUID) -> Client:
    """
    Idempotent: return the org's default client, creating one if missing.
    Safe to call from migrations, startup, and future upload paths.
    """
    existing = get_default_client(db, organization_id)
    if existing:
        return existing

    by_slug = (
        db.query(Client)
        .filter(
            Client.organization_id == organization_id,
            Client.slug == DEFAULT_CLIENT_SLUG,
        )
        .first()
    )
    if by_slug:
        if not by_slug.is_default:
            by_slug.is_default = True
            db.flush()
        return by_slug

    org = db.get(Organization, organization_id)
    name = org.name if org else "Default client"
    client = Client(
        id=uuid4(),
        organization_id=organization_id,
        name=name,
        slug=DEFAULT_CLIENT_SLUG,
        status=ClientStatus.ACTIVE,
        is_default=True,
        notes="Auto-created default client for pre-multi-client data",
    )
    db.add(client)
    db.flush()
    return client


def backfill_organization_clients(db: Session) -> dict[str, int]:
    """
    For every organization: ensure a default client and set client_id on
    tenant rows that are still NULL. Leaves system rows (null org) alone.
    """
    orgs = db.query(Organization).all()
    created = 0
    updated_rows = 0

    tables = (
        "bank_accounts",
        "documents",
        "transactions",
        "category_rules",
        "reports",
        "period_closes",
        "audit_logs",
        "merchants",
        "merchant_aliases",
    )

    for org in orgs:
        before = get_default_client(db, org.id)
        client = ensure_default_client(db, org.id)
        if before is None:
            created += 1
        cid = str(client.id)
        oid = str(org.id)
        for table in tables:
            # Merchants/aliases: only org-owned rows (not system-wide)
            if table in ("merchants", "merchant_aliases"):
                result = db.execute(
                    text(
                        f"""
                        UPDATE {table}
                        SET client_id = :cid
                        WHERE organization_id = :oid
                          AND client_id IS NULL
                        """
                    ),
                    {"cid": cid, "oid": oid},
                )
            else:
                result = db.execute(
                    text(
                        f"""
                        UPDATE {table}
                        SET client_id = :cid
                        WHERE organization_id = :oid
                          AND client_id IS NULL
                        """
                    ),
                    {"cid": cid, "oid": oid},
                )
            updated_rows += int(result.rowcount or 0)

    db.flush()
    return {"organizations": len(orgs), "clients_created": created, "rows_updated": updated_rows}
