from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import extract, func
from sqlalchemy.orm import Session, joinedload

from app.models.category import Category, CategoryType
from app.models.transaction import Transaction
from app.schemas import DashboardSummary


def get_dashboard_summary(db: Session, organization_id: UUID) -> DashboardSummary:
    rows = db.query(Transaction).filter(Transaction.organization_id == organization_id).all()

    total_income = Decimal("0")
    total_expenses = Decimal("0")
    for tx in rows:
        if tx.credit:
            total_income += Decimal(tx.credit)
        if tx.debit:
            total_expenses += Decimal(tx.debit)

    # Top expense categories
    expense_agg = (
        db.query(Category.name, func.coalesce(func.sum(Transaction.debit), 0).label("total"))
        .join(Transaction, Transaction.category_id == Category.id)
        .filter(
            Transaction.organization_id == organization_id,
            Category.type == CategoryType.EXPENSE,
            Transaction.debit.isnot(None),
        )
        .group_by(Category.name)
        .order_by(func.sum(Transaction.debit).desc())
        .limit(5)
        .all()
    )
    top_expense_categories = [
        {"name": name, "total": float(total)} for name, total in expense_agg
    ]

    # Monthly trends (last 12 months of data present)
    monthly = (
        db.query(
            extract("year", Transaction.transaction_date).label("year"),
            extract("month", Transaction.transaction_date).label("month"),
            func.coalesce(func.sum(Transaction.credit), 0).label("income"),
            func.coalesce(func.sum(Transaction.debit), 0).label("expenses"),
        )
        .filter(Transaction.organization_id == organization_id)
        .group_by("year", "month")
        .order_by("year", "month")
        .all()
    )
    monthly_trends = [
        {
            "month": f"{int(year):04d}-{int(month):02d}",
            "income": float(income),
            "expenses": float(expenses),
            "net": float(Decimal(income) - Decimal(expenses)),
        }
        for year, month, income, expenses in monthly
    ]

    return DashboardSummary(
        total_income=total_income,
        total_expenses=total_expenses,
        net_cash_flow=total_income - total_expenses,
        transaction_count=len(rows),
        needs_review_count=sum(1 for r in rows if r.needs_review),
        top_expense_categories=top_expense_categories,
        monthly_trends=monthly_trends,
    )


def report_payload(
    db: Session,
    organization_id: UUID,
    period_start: date,
    period_end: date,
) -> dict:
    txs = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(
            Transaction.organization_id == organization_id,
            Transaction.transaction_date >= period_start,
            Transaction.transaction_date <= period_end,
        )
        .order_by(Transaction.transaction_date.asc())
        .all()
    )

    income = sum((Decimal(t.credit or 0) for t in txs), Decimal("0"))
    expenses = sum((Decimal(t.debit or 0) for t in txs), Decimal("0"))

    by_category: dict[str, dict] = {}
    for t in txs:
        cat = db.get(Category, t.category_id) if t.category_id else None
        name = cat.name if cat else "Uncategorized"
        ctype = cat.type.value if cat else "expense"
        bucket = by_category.setdefault(name, {"name": name, "type": ctype, "income": 0.0, "expenses": 0.0})
        bucket["income"] += float(t.credit or 0)
        bucket["expenses"] += float(t.debit or 0)

    tax_related = [
        {
            "date": t.transaction_date.isoformat(),
            "description": t.description,
            "debit": float(t.debit) if t.debit else None,
            "credit": float(t.credit) if t.credit else None,
        }
        for t in txs
        if t.category and t.category.slug == "taxes"
    ]

    return {
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "total_income": float(income),
        "total_expenses": float(expenses),
        "net_cash_flow": float(income - expenses),
        "transaction_count": len(txs),
        "reviewed_count": sum(1 for t in txs if not t.needs_review),
        "needs_review_count": sum(1 for t in txs if t.needs_review),
        "by_category": list(by_category.values()),
        "tax_related": tax_related,
        "transactions": [
            {
                "date": t.transaction_date.isoformat(),
                "description": t.description,
                "debit": float(t.debit) if t.debit else None,
                "credit": float(t.credit) if t.credit else None,
                "balance": float(t.balance) if t.balance else None,
                "category": t.category.name if t.category else "Uncategorized",
                "category_type": (
                    t.category.type.value if t.category else "expense"
                ),
                "reference": t.reference,
                "confidence": float(t.confidence_score)
                if t.confidence_score is not None
                else None,
                "needs_review": bool(t.needs_review),
                "review_status": "Needs review" if t.needs_review else "Reviewed",
            }
            for t in txs
        ],
    }
