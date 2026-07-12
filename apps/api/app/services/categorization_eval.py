from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.category import Category
from app.models.document import Document
from app.models.transaction import Transaction
from app.services.merchants import seed_system_merchants
from app.services.rules import resolve_category


# Deterministic fixtures: description → expected merchant slug / category slug
CATEGORIZATION_FIXTURES: list[dict[str, str]] = [
    {
        "description": "Online Paid to SHELL PAKISTAN LTD",
        "merchant_slug": "shell",
        "category_slug": "fuel",
    },
    {
        "description": "SHELL PUMP LAHORE Visa xxxx1909",
        "merchant_slug": "shell",
        "category_slug": "fuel",
    },
    {
        "description": "POS SHELL POS 1234",
        "merchant_slug": "shell",
        "category_slug": "fuel",
    },
    {
        "description": "Online Paid to HETZNER ONLINE WWW.HETZNER.CDE",
        "merchant_slug": "hetzner",
        "category_slug": "purchases",
    },
    {
        "description": "Online Paid to CURSOR, AI POWERED IDE",
        "merchant_slug": "cursor",
        "category_slug": "purchases",
    },
    {
        "description": "PSO PUMP ISLAMABAD",
        "merchant_slug": "pso",
        "category_slug": "fuel",
    },
    {
        "description": "K-ELECTRIC BILL PAYMENT",
        "merchant_slug": "k-electric",
        "category_slug": "utilities",
    },
    {
        "description": "GOOGLE ADS CAMPAIGN",
        "merchant_slug": "google",
        "category_slug": "marketing",
    },
]


def run_categorization_eval(db: Session, organization_id: UUID | None = None) -> dict[str, Any]:
    """
    Before/after style eval on fixtures:
    - before: AI slug alone mocked as 'other' (worst case) vs heuristic not used
    - after: full resolve_category with merchants + rules
    """
    seed_system_merchants(db)
    db.flush()

    # Use a throwaway org id for matching system merchants only if none provided
    org_id = organization_id
    if org_id is None:
        # System merchants match with any org id
        from app.models.organization import Organization

        org = db.query(Organization).first()
        org_id = org.id if org else UUID("00000000-0000-0000-0000-000000000001")

    before_correct = 0
    after_correct = 0
    merchant_hits = 0
    other_before = 0
    other_after = 0
    details: list[dict[str, Any]] = []

    for row in CATEGORIZATION_FIXTURES:
        desc = row["description"]
        expected_cat = row["category_slug"]
        expected_merchant = row["merchant_slug"]

        # Before rules: pretend extractor returned "other"
        before_slug = "other"
        other_before += 1
        if before_slug == expected_cat:
            before_correct += 1

        cat, from_det, merchant = resolve_category(
            db,
            organization_id=org_id,
            description=desc,
            ai_category_slug="other",
        )
        after_slug = cat.slug
        if after_slug == "other":
            other_after += 1
        if after_slug == expected_cat:
            after_correct += 1
        if merchant and merchant.slug == expected_merchant:
            merchant_hits += 1

        details.append(
            {
                "description": desc,
                "expected_category": expected_cat,
                "expected_merchant": expected_merchant,
                "before_category": before_slug,
                "after_category": after_slug,
                "merchant": merchant.slug if merchant else None,
                "from_deterministic": from_det,
            }
        )

    n = len(CATEGORIZATION_FIXTURES) or 1
    return {
        "fixture_count": n,
        "before_rules_accuracy": round(before_correct / n, 4),
        "after_rules_accuracy": round(after_correct / n, 4),
        "merchant_match_rate": round(merchant_hits / n, 4),
        "other_before": other_before,
        "other_after": other_after,
        "other_reduction": other_before - other_after,
        "other_reduction_pct": round((other_before - other_after) / other_before, 4)
        if other_before
        else 0,
        "details": details,
    }


def org_categorization_stats(db: Session, organization_id: UUID) -> dict[str, Any]:
    """Live org stats from stored transactions + latest document extraction meta."""
    total = (
        db.query(func.count(Transaction.id))
        .filter(Transaction.organization_id == organization_id)
        .scalar()
        or 0
    )
    other = (
        db.query(func.count(Transaction.id))
        .join(Category, Transaction.category_id == Category.id)
        .filter(
            Transaction.organization_id == organization_id,
            Category.slug == "other",
        )
        .scalar()
        or 0
    )
    with_merchant = (
        db.query(func.count(Transaction.id))
        .filter(
            Transaction.organization_id == organization_id,
            Transaction.merchant_id.isnot(None),
        )
        .scalar()
        or 0
    )

    latest_meta = None
    doc = (
        db.query(Document)
        .filter(
            Document.organization_id == organization_id,
            Document.extraction_meta_json.isnot(None),
        )
        .order_by(Document.created_at.desc())
        .first()
    )
    if doc and isinstance(doc.extraction_meta_json, dict):
        latest_meta = doc.extraction_meta_json.get("categorization")

    return {
        "transaction_count": total,
        "other_count": other,
        "other_rate": round(other / total, 4) if total else 0,
        "merchant_linked_count": with_merchant,
        "merchant_link_rate": round(with_merchant / total, 4) if total else 0,
        "latest_document_categorization": latest_meta,
    }
