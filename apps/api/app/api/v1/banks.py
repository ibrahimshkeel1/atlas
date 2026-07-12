from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import CurrentUser
from app.services.pakistan_banks import pakistan_banks_summary

router = APIRouter(prefix="/banks", tags=["banks"])


@router.get("")
def list_banks(_user: CurrentUser) -> dict:
    """Catalog of Pakistan banks Atlas knows about (detection + parser status)."""
    return pakistan_banks_summary()
