from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.category import Category
from app.models.category_rule import CategoryRule, MatchType
from app.models.merchant import Merchant
from app.services.categories import get_other_category, resolve_category_by_slug
from app.services.merchants import match_merchant


def normalize_pattern(description: str) -> str:
    text = description.lower().strip()
    text = re.sub(r"\s+", " ", text)
    # Prefer merchant-like token: first meaningful chunk
    parts = [p for p in re.split(r"[^a-z0-9]+", text) if len(p) >= 3]
    if not parts:
        return text[:64]
    # Join first 2-3 tokens for a stable merchant key
    return " ".join(parts[:3])[:128]


def match_rule(db: Session, organization_id: UUID, description: str) -> Category | None:
    rules = (
        db.query(CategoryRule)
        .filter(CategoryRule.organization_id == organization_id)
        .order_by(CategoryRule.priority.asc(), CategoryRule.created_at.desc())
        .all()
    )
    desc_lower = description.lower()
    for rule in rules:
        pattern = rule.pattern.lower()
        if rule.match_type == MatchType.EXACT and desc_lower.strip() == pattern:
            return db.get(Category, rule.category_id)
        if rule.match_type == MatchType.CONTAINS and pattern in desc_lower:
            return db.get(Category, rule.category_id)
    return None


def upsert_rule(
    db: Session,
    *,
    organization_id: UUID,
    description: str,
    category_id: UUID,
) -> CategoryRule:
    pattern = normalize_pattern(description)
    existing = (
        db.query(CategoryRule)
        .filter(
            CategoryRule.organization_id == organization_id,
            CategoryRule.pattern == pattern,
            CategoryRule.match_type == MatchType.CONTAINS,
        )
        .first()
    )
    if existing:
        existing.category_id = category_id
        existing.priority = 10
        db.flush()
        return existing

    rule = CategoryRule(
        organization_id=organization_id,
        match_type=MatchType.CONTAINS,
        pattern=pattern,
        category_id=category_id,
        priority=10,
    )
    db.add(rule)
    db.flush()
    return rule


def build_rule_suggestion(
    *,
    description: str,
    category: Category,
    merchant_name: str | None = None,
) -> dict:
    """Preview for opt-in learning rule after a manual category change."""
    pattern = normalize_pattern(description)
    label = merchant_name or (pattern.title() if pattern else "This merchant")
    return {
        "pattern": pattern,
        "category_id": category.id,
        "category_name": category.name,
        "merchant_name": merchant_name,
        "preview": f"Remember {label} → {category.name}?",
    }


def resolve_category(
    db: Session,
    *,
    organization_id: UUID,
    description: str,
    ai_category_slug: str | None,
    client_id: UUID | None = None,
) -> tuple[Category, bool, Merchant | None]:
    """
    Deterministic-first categorization.
    Returns (category, from_deterministic_rule, merchant).

    Order:
      1. User category_rules (explicit learning rules)
      2. Merchant aliases (system + org + client-ready)
      3. AI / heuristic slug
      4. Other
    """
    ruled = match_rule(db, organization_id, description)
    if ruled:
        merchant = match_merchant(
            db, organization_id, description, client_id=client_id
        )
        return ruled, True, merchant

    merchant = match_merchant(db, organization_id, description, client_id=client_id)
    if merchant and merchant.category_id:
        cat = db.get(Category, merchant.category_id)
        if cat:
            return cat, True, merchant

    if ai_category_slug:
        cat = resolve_category_by_slug(db, organization_id, ai_category_slug)
        if cat:
            return cat, False, merchant

    return get_other_category(db), False, merchant
