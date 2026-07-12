from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.category import Category, CategoryType
from app.models.category_rule import CategoryRule
from app.models.transaction import Transaction

SYSTEM_CATEGORIES = [
    ("Sales", "sales", CategoryType.INCOME),
    ("Customer payments", "customer-payments", CategoryType.INCOME),
    ("Investment", "investment", CategoryType.INCOME),
    ("Loan", "loan", CategoryType.INCOME),
    ("Fuel", "fuel", CategoryType.EXPENSE),
    ("Salaries", "salaries", CategoryType.EXPENSE),
    ("Rent", "rent", CategoryType.EXPENSE),
    ("Utilities", "utilities", CategoryType.EXPENSE),
    ("Marketing", "marketing", CategoryType.EXPENSE),
    ("Purchases", "purchases", CategoryType.EXPENSE),
    ("Taxes", "taxes", CategoryType.EXPENSE),
    ("Other", "other", CategoryType.EXPENSE),
]


def seed_system_categories(db: Session) -> None:
    existing = {
        c.slug
        for c in db.query(Category).filter(Category.organization_id.is_(None)).all()
    }
    for name, slug, ctype in SYSTEM_CATEGORIES:
        if slug in existing:
            continue
        db.add(Category(organization_id=None, name=name, slug=slug, type=ctype))
    db.flush()


def get_system_categories(db: Session) -> list[Category]:
    return (
        db.query(Category)
        .filter(Category.organization_id.is_(None))
        .order_by(Category.type, Category.name)
        .all()
    )


def list_categories_for_org(db: Session, organization_id: UUID) -> list[Category]:
    """System defaults + this org's custom categories."""
    return (
        db.query(Category)
        .filter(
            or_(
                Category.organization_id.is_(None),
                Category.organization_id == organization_id,
            )
        )
        .order_by(Category.type, Category.name)
        .all()
    )


def get_category_by_slug(db: Session, slug: str) -> Category | None:
    return (
        db.query(Category)
        .filter(Category.organization_id.is_(None), Category.slug == slug)
        .first()
    )


def resolve_category_by_slug(
    db: Session, organization_id: UUID, slug: str
) -> Category | None:
    """Prefer org custom slug, then system slug."""
    cleaned = (slug or "").strip().lower().replace(" ", "-")
    if not cleaned:
        return None
    custom = (
        db.query(Category)
        .filter(
            Category.organization_id == organization_id,
            Category.slug == cleaned,
        )
        .first()
    )
    if custom:
        return custom
    return get_category_by_slug(db, cleaned)


def org_category_slugs(db: Session, organization_id: UUID) -> set[str]:
    return {c.slug for c in list_categories_for_org(db, organization_id)}


def get_other_category(db: Session) -> Category:
    cat = get_category_by_slug(db, "other")
    if not cat:
        seed_system_categories(db)
        cat = get_category_by_slug(db, "other")
    assert cat is not None
    return cat


def category_to_out(c: Category):
    from app.schemas import CategoryOut

    return CategoryOut(
        id=c.id,
        name=c.name,
        slug=c.slug,
        type=c.type.value if hasattr(c.type, "value") else str(c.type),
        is_system=c.organization_id is None,
    )


def slugify_category_name(name: str) -> str:
    text = name.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return (text or "category")[:120]


def _unique_org_slug(db: Session, organization_id: UUID, base: str) -> str:
    slug = base
    n = 2
    while True:
        clash = (
            db.query(Category)
            .filter(
                Category.organization_id == organization_id,
                Category.slug == slug,
            )
            .first()
        )
        if not clash:
            return slug
        slug = f"{base}-{n}"[:128]
        n += 1
        if n > 50:
            return f"{base}-{organization_id.hex[:8]}"[:128]


def assert_category_usable(
    db: Session, organization_id: UUID, category_id: UUID
) -> Category:
    category = db.get(Category, category_id)
    if not category:
        raise ValueError("Invalid category")
    if category.organization_id is not None and category.organization_id != organization_id:
        raise ValueError("Invalid category")
    return category


def create_org_category(
    db: Session,
    *,
    organization_id: UUID,
    name: str,
    category_type: CategoryType,
) -> Category:
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("Name is required")
    if len(cleaned) > 128:
        raise ValueError("Name is too long")

    # Block duplicate display names within org (case-insensitive)
    existing_names = {
        c.name.lower()
        for c in list_categories_for_org(db, organization_id)
    }
    if cleaned.lower() in existing_names:
        raise ValueError("A category with that name already exists")

    slug = _unique_org_slug(db, organization_id, slugify_category_name(cleaned))
    cat = Category(
        organization_id=organization_id,
        name=cleaned,
        slug=slug,
        type=category_type,
    )
    db.add(cat)
    db.flush()
    return cat


def update_org_category(
    db: Session,
    *,
    organization_id: UUID,
    category_id: UUID,
    name: str | None = None,
    category_type: CategoryType | None = None,
) -> Category:
    cat = db.get(Category, category_id)
    if not cat or cat.organization_id != organization_id:
        raise ValueError("Custom category not found")
    if name is not None:
        cleaned = name.strip()
        if not cleaned:
            raise ValueError("Name is required")
        clash = (
            db.query(Category)
            .filter(
                or_(
                    Category.organization_id.is_(None),
                    Category.organization_id == organization_id,
                ),
                Category.id != category_id,
            )
            .all()
        )
        if any(c.name.lower() == cleaned.lower() for c in clash):
            raise ValueError("A category with that name already exists")
        cat.name = cleaned
    if category_type is not None:
        cat.type = category_type
    db.flush()
    return cat


def delete_org_category(
    db: Session,
    *,
    organization_id: UUID,
    category_id: UUID,
    reassign_to_id: UUID | None = None,
) -> None:
    cat = db.get(Category, category_id)
    if not cat or cat.organization_id != organization_id:
        raise ValueError("Custom category not found")

    if reassign_to_id:
        target = assert_category_usable(db, organization_id, reassign_to_id)
        if target.id == cat.id:
            raise ValueError("Cannot reassign to the same category")
    else:
        target = get_other_category(db)

    db.query(Transaction).filter(
        Transaction.organization_id == organization_id,
        Transaction.category_id == cat.id,
    ).update({Transaction.category_id: target.id}, synchronize_session=False)

    db.query(CategoryRule).filter(
        CategoryRule.organization_id == organization_id,
        CategoryRule.category_id == cat.id,
    ).update({CategoryRule.category_id: target.id}, synchronize_session=False)

    db.delete(cat)
    db.flush()
