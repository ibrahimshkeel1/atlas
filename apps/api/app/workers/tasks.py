from __future__ import annotations

from uuid import UUID

from app.db.session import SessionLocal
from app.services.pipeline import process_document


def process_document_task(document_id: str, job_id: str) -> None:
    db = SessionLocal()
    try:
        process_document(db, UUID(document_id), UUID(job_id))
    finally:
        db.close()
