from __future__ import annotations

import re
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.models.category import Category
from app.models.merchant import (
    Merchant,
    MerchantAlias,
    MerchantAliasMatchType,
    MerchantAliasSource,
)
from app.services.categories import get_category_by_slug, seed_system_categories


def _normalize_pattern(description: str) -> str:
    text = description.lower().strip()
    text = re.sub(r"\s+", " ", text)
    parts = [p for p in re.split(r"[^a-z0-9]+", text) if len(p) >= 3]
    if not parts:
        return text[:64]
    return " ".join(parts[:3])[:128]

# (merchant_name, merchant_slug, category_slug, aliases)
SYSTEM_MERCHANTS: list[tuple[str, str, str, list[str]]] = [
    ("Shell", "shell", "fuel", ["shell pakistan", "shell pump", "shell pos", "shell ltd"]),
    ("PSO", "pso", "fuel", ["pso pump", "pakistan state oil", "pso ltd"]),
    ("Total Parco", "total-parco", "fuel", ["total parco", "totalenergies", "total pump"]),
    ("Hetzner", "hetzner", "purchases", ["hetzner online", "hetzner.com", "www.hetzner"]),
    ("Cursor", "cursor", "purchases", ["cursor ai", "cursor,", "cursor powered"]),
    ("Google", "google", "marketing", ["google ads", "google cloud", "google *"]),
    ("Facebook", "facebook", "marketing", ["facebook ads", "meta platforms", "instagram ads"]),
    ("K-Electric", "k-electric", "utilities", ["k-electric", "ke electric", "kesc"]),
    ("SSGC", "ssgc", "utilities", ["ssgc", "sui southern", "sui gas"]),
    ("PTCL", "ptcl", "utilities", ["ptcl", "pakistan tele"]),
    ("NayaPay", "nayapay", "customer-payments", ["nayapay", "naya pay"]),
    ("JazzCash", "jazzcash", "customer-payments", ["jazzcash", "jazz cash"]),
    ("EasyPaisa", "easypaisa", "customer-payments", ["easypaisa", "easy paisa"]),
]


def slugify_merchant(name: str) -> str:
    text = name.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return (text or "merchant")[:120]


def seed_system_merchants(db: Session) -> None:
    seed_system_categories(db)
    existing = {
        m.slug
        for m in db.query(Merchant).filter(Merchant.organization_id.is_(None)).all()
    }
    for name, slug, cat_slug, aliases in SYSTEM_MERCHANTS:
        cat = get_category_by_slug(db, cat_slug)
        if slug not in existing:
            m = Merchant(
                organization_id=None,
                client_id=None,
                name=name,
                slug=slug,
                category_id=cat.id if cat else None,
            )
            db.add(m)
            db.flush()
        else:
            m = (
                db.query(Merchant)
                .filter(Merchant.organization_id.is_(None), Merchant.slug == slug)
                .first()
            )
            assert m is not None
            if cat and m.category_id is None:
                m.category_id = cat.id

        for alias in aliases:
            pattern = alias.lower().strip()
            exists = (
                db.query(MerchantAlias)
                .filter(
                    MerchantAlias.organization_id.is_(None),
                    MerchantAlias.pattern == pattern,
                    MerchantAlias.match_type == MerchantAliasMatchType.CONTAINS,
                )
                .first()
            )
            if exists:
                continue
            db.add(
                MerchantAlias(
                    merchant_id=m.id,
                    organization_id=None,
                    client_id=None,
                    pattern=pattern,
                    match_type=MerchantAliasMatchType.CONTAINS,
                    priority=50,
                    source=MerchantAliasSource.SYSTEM,
                )
            )
    db.flush()


def _alias_matches(alias: MerchantAlias, desc_lower: str) -> bool:
    pattern = alias.pattern.lower()
    if alias.match_type == MerchantAliasMatchType.EXACT:
        return desc_lower.strip() == pattern
    if alias.match_type == MerchantAliasMatchType.PREFIX:
        return desc_lower.startswith(pattern) or f" {pattern}" in f" {desc_lower}"
    return pattern in desc_lower


def match_merchant(
    db: Session,
    organization_id: UUID,
    description: str,
    *,
    client_id: UUID | None = None,
) -> Optional[Merchant]:
    """Deterministic merchant match. Org/client aliases beat system; lower priority wins."""
    desc_lower = (description or "").lower()
    if not desc_lower.strip():
        return None

    q = (
        db.query(MerchantAlias)
        .options(joinedload(MerchantAlias.merchant).joinedload(Merchant.category))
        .filter(
            or_(
                MerchantAlias.organization_id == organization_id,
                MerchantAlias.organization_id.is_(None),
            )
        )
    )
    # Prefer client-specific when provided; always include null client_id
    if client_id is not None:
        q = q.filter(
            or_(MerchantAlias.client_id == client_id, MerchantAlias.client_id.is_(None))
        )
    else:
        q = q.filter(MerchantAlias.client_id.is_(None))

    aliases = q.order_by(
        MerchantAlias.organization_id.is_(None).asc(),  # org first
        MerchantAlias.client_id.is_(None).asc(),  # client-specific first when present
        MerchantAlias.priority.asc(),
        MerchantAlias.created_at.desc(),
    ).all()

    for alias in aliases:
        if _alias_matches(alias, desc_lower):
            return alias.merchant
    return None


def list_merchants_for_org(db: Session, organization_id: UUID) -> list[Merchant]:
    return (
        db.query(Merchant)
        .options(joinedload(Merchant.category), joinedload(Merchant.aliases))
        .filter(
            or_(
                Merchant.organization_id == organization_id,
                Merchant.organization_id.is_(None),
            )
        )
        .order_by(Merchant.name)
        .all()
    )


def learn_merchant_from_correction(
    db: Session,
    *,
    organization_id: UUID,
    description: str,
    category_id: UUID,
    merchant_name: str | None = None,
    client_id: UUID | None = None,
) -> tuple[Merchant, MerchantAlias, dict[str, Any]]:
    """
    Create/update org merchant + learned alias from a user category correction.
    Returns (merchant, alias, suggestion_meta).
    """
    pattern = _normalize_pattern(description)
    if not pattern or len(pattern) < 3:
        raise ValueError("Description too short to learn a merchant pattern")

    # Prefer existing merchant that already owns this pattern
    existing_alias = (
        db.query(MerchantAlias)
        .options(joinedload(MerchantAlias.merchant))
        .filter(
            MerchantAlias.organization_id == organization_id,
            MerchantAlias.pattern == pattern,
            MerchantAlias.match_type == MerchantAliasMatchType.CONTAINS,
        )
        .first()
    )
    if existing_alias:
        merchant = existing_alias.merchant
        merchant.category_id = category_id
        existing_alias.priority = 10
        existing_alias.source = MerchantAliasSource.LEARNED
        db.flush()
        cat = db.get(Category, category_id)
        return merchant, existing_alias, {
            "pattern": pattern,
            "merchant_name": merchant.name,
            "category_name": cat.name if cat else "",
            "preview": f"Remember {merchant.name} → {cat.name if cat else 'category'}?",
            "created": False,
        }

    # Derive display name from pattern tokens
    display = (merchant_name or pattern).strip()
    display = " ".join(w.capitalize() for w in display.split())[:255] or "Merchant"
    slug = slugify_merchant(display)

    merchant = (
        db.query(Merchant)
        .filter(
            Merchant.organization_id == organization_id,
            Merchant.slug == slug,
        )
        .first()
    )
    if not merchant:
        # Avoid colliding with system slug by suffixing org merchants when needed
        base = slug
        n = 2
        while (
            db.query(Merchant)
            .filter(
                or_(
                    Merchant.organization_id == organization_id,
                    Merchant.organization_id.is_(None),
                ),
                Merchant.slug == slug,
            )
            .first()
        ):
            slug = f"{base}-{n}"[:128]
            n += 1
            if n > 40:
                break
        merchant = Merchant(
            organization_id=organization_id,
            client_id=client_id,
            name=display,
            slug=slug,
            category_id=category_id,
        )
        db.add(merchant)
        db.flush()
    else:
        merchant.category_id = category_id
        if client_id and merchant.client_id is None:
            merchant.client_id = client_id

    alias = MerchantAlias(
        merchant_id=merchant.id,
        organization_id=organization_id,
        client_id=client_id,
        pattern=pattern,
        match_type=MerchantAliasMatchType.CONTAINS,
        priority=10,
        source=MerchantAliasSource.LEARNED,
    )
    db.add(alias)
    db.flush()
    cat = db.get(Category, category_id)
    return merchant, alias, {
        "pattern": pattern,
        "merchant_name": merchant.name,
        "category_name": cat.name if cat else "",
        "preview": f"Remember {merchant.name} → {cat.name if cat else 'category'}?",
        "created": True,
    }


def create_org_merchant(
    db: Session,
    *,
    organization_id: UUID,
    name: str,
    category_id: UUID | None,
    aliases: list[str] | None = None,
    client_id: UUID | None = None,
) -> Merchant:
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("Name is required")
    slug = slugify_merchant(cleaned)
    clash = (
        db.query(Merchant)
        .filter(
            Merchant.organization_id == organization_id,
            Merchant.slug == slug,
        )
        .first()
    )
    if clash:
        raise ValueError("A merchant with that name already exists")

    merchant = Merchant(
        organization_id=organization_id,
        client_id=client_id,
        name=cleaned,
        slug=slug,
        category_id=category_id,
    )
    db.add(merchant)
    db.flush()
    for raw in aliases or []:
        pattern = raw.strip().lower()
        if len(pattern) < 2:
            continue
        db.add(
            MerchantAlias(
                merchant_id=merchant.id,
                organization_id=organization_id,
                client_id=client_id,
                pattern=pattern,
                match_type=MerchantAliasMatchType.CONTAINS,
                priority=20,
                source=MerchantAliasSource.USER,
            )
        )
    db.flush()
    return merchant
