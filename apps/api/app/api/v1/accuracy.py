from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import CurrentUser, DbSession
from app.services.accuracy import run_eval
from app.services.categorization_eval import org_categorization_stats, run_categorization_eval

router = APIRouter(prefix="/accuracy", tags=["accuracy"])


@router.get("/report")
def accuracy_report(_user: CurrentUser) -> dict:
    """Parser accuracy against bundled bank fixtures (pilot trust metric)."""
    return run_eval()


@router.get("/categorization")
def categorization_accuracy(user: CurrentUser, db: DbSession) -> dict:
    """Merchant/rules before vs after accuracy + live org Other reduction."""
    fixture_eval = run_categorization_eval(db, user.organization_id)
    live = org_categorization_stats(db, user.organization_id)
    return {"fixtures": fixture_eval, "live": live}
