from fastapi import APIRouter

from app.core.deps import CurrentUser, DbSession
from app.schemas import DashboardSummary
from app.services.dashboard import get_dashboard_summary

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def summary(user: CurrentUser, db: DbSession) -> DashboardSummary:
    return get_dashboard_summary(db, user.organization_id)
