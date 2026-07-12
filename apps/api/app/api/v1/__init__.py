from fastapi import APIRouter

from app.api.v1 import (
    accuracy,
    audit_logs,
    auth,
    banks,
    categories,
    dashboard,
    documents,
    eval as eval_api,
    files,
    merchants,
    reports,
    review,
    transactions,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(documents.router)
api_router.include_router(banks.router)
api_router.include_router(categories.router)
api_router.include_router(merchants.router)
api_router.include_router(transactions.router)
api_router.include_router(reports.router)
api_router.include_router(review.router)
api_router.include_router(accuracy.router)
api_router.include_router(eval_api.router)
api_router.include_router(files.router)
api_router.include_router(audit_logs.router)
