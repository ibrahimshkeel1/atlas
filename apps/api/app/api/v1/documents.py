from __future__ import annotations

import io
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import Response

from sqlalchemy import func

from app.core.config import get_settings
from app.core.deps import CurrentUser, DbSession
from app.core.security_hardening import sanitize_filename
from app.models.ai_processing_job import AIProcessingJob, JobStatus
from app.models.document import Document, DocumentStatus
from app.models.transaction import Transaction
from app.schemas import DocumentOut
from app.services.audit import AuditAction, write_audit
from app.services.clients import ensure_default_client
from app.services.storage import download_bytes, upload_file
from app.workers.queue import enqueue_document_processing

router = APIRouter(prefix="/documents", tags=["documents"])


def _doc_out(doc: Document, transaction_count: int = 0) -> DocumentOut:
    return DocumentOut(
        id=doc.id,
        filename=doc.filename,
        status=doc.status.value,
        page_count=doc.page_count,
        error_message=doc.error_message,
        bank_name=doc.bank_name,
        created_at=doc.created_at.isoformat() if doc.created_at else None,
        transaction_count=transaction_count,
        extraction_meta=doc.extraction_meta_json,
    )


@router.get("", response_model=list[DocumentOut])
def list_documents(user: CurrentUser, db: DbSession) -> list[DocumentOut]:
    docs = (
        db.query(Document)
        .filter(Document.organization_id == user.organization_id)
        .order_by(Document.created_at.desc())
        .all()
    )
    counts = dict(
        db.query(Transaction.document_id, func.count(Transaction.id))
        .filter(Transaction.organization_id == user.organization_id)
        .group_by(Transaction.document_id)
        .all()
    )
    return [_doc_out(d, counts.get(d.id, 0)) for d in docs]


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: UUID, user: CurrentUser, db: DbSession) -> DocumentOut:
    doc = (
        db.query(Document)
        .filter(Document.id == document_id, Document.organization_id == user.organization_id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    count = (
        db.query(func.count(Transaction.id))
        .filter(Transaction.document_id == doc.id)
        .scalar()
        or 0
    )
    return _doc_out(doc, int(count))


@router.get("/{document_id}/file")
def get_document_file(document_id: UUID, user: CurrentUser, db: DbSession) -> Response:
    """Authenticated PDF bytes for side-by-side review (org-scoped)."""
    doc = (
        db.query(Document)
        .filter(Document.id == document_id, Document.organization_id == user.organization_id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        data = download_bytes(doc.s3_key)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="File not found in storage") from exc
    filename = doc.filename or "statement.pdf"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "private, max-age=60",
        },
    )


@router.post("/{document_id}/reprocess", response_model=DocumentOut)
def reprocess_document(document_id: UUID, user: CurrentUser, db: DbSession) -> DocumentOut:
    doc = (
        db.query(Document)
        .filter(Document.id == document_id, Document.organization_id == user.organization_id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    job = AIProcessingJob(document_id=doc.id, status=JobStatus.QUEUED)
    db.add(job)
    db.flush()
    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        client_id=doc.client_id,
        action=AuditAction.DOCUMENT_REPROCESS,
        entity_type="document",
        entity_id=str(doc.id),
        before={"status": doc.status.value if doc.status else None, "filename": doc.filename},
        after={"status": "queued"},
    )
    db.commit()

    from app.services.pipeline import process_document

    try:
        process_document(db, doc.id, job.id)
    except Exception:
        # Status/error already persisted on document by pipeline
        pass
    db.refresh(doc)
    count = (
        db.query(func.count(Transaction.id))
        .filter(Transaction.document_id == doc.id)
        .scalar()
        or 0
    )
    return _doc_out(doc, int(count))


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: UUID, user: CurrentUser, db: DbSession) -> None:
    doc = (
        db.query(Document)
        .filter(Document.id == document_id, Document.organization_id == user.organization_id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    s3_key = doc.s3_key
    filename = doc.filename
    before_status = doc.status.value if doc.status else None
    client_id = doc.client_id

    db.query(Transaction).filter(
        Transaction.document_id == doc.id,
        Transaction.organization_id == user.organization_id,
    ).delete(synchronize_session=False)
    db.query(AIProcessingJob).filter(AIProcessingJob.document_id == doc.id).delete(
        synchronize_session=False
    )
    db.delete(doc)

    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        client_id=client_id,
        action=AuditAction.DOCUMENT_DELETE,
        entity_type="document",
        entity_id=str(document_id),
        before={"filename": filename, "status": before_status},
        meta={"s3_key": s3_key},
    )
    db.commit()

    try:
        from app.services.storage import delete_object

        delete_object(s3_key)
    except Exception:
        # DB row is gone; file cleanup is best-effort
        pass


@router.post("/upload", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
    force: bool = False,
) -> DocumentOut:
    import hashlib

    settings = get_settings()
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    safe_name = sanitize_filename(file.filename)
    content = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds {settings.max_upload_mb}MB limit",
        )
    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Invalid PDF file")

    content_hash = hashlib.sha256(content).hexdigest()
    if not force:
        dup = (
            db.query(Document)
            .filter(
                Document.organization_id == user.organization_id,
                Document.content_hash == content_hash,
            )
            .order_by(Document.created_at.desc())
            .first()
        )
        if dup:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Duplicate statement detected (same file as “{dup.filename}”). "
                    "Re-upload with force=true if you really want a copy."
                ),
            )

    try:
        key = upload_file(
            io.BytesIO(content),
            str(user.organization_id),
            safe_name,
            "application/pdf",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {exc}") from exc

    doc = Document(
        organization_id=user.organization_id,
        client_id=ensure_default_client(db, user.organization_id).id,
        filename=safe_name,
        s3_key=key,
        status=DocumentStatus.UPLOADED,
        content_hash=content_hash,
    )
    db.add(doc)
    db.flush()

    job = AIProcessingJob(document_id=doc.id, status=JobStatus.QUEUED)
    db.add(job)
    db.flush()

    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        client_id=doc.client_id,
        action=AuditAction.DOCUMENT_UPLOAD,
        entity_type="document",
        entity_id=str(doc.id),
        after={"filename": safe_name, "status": DocumentStatus.UPLOADED.value},
        meta={"content_hash": content_hash, "force": force},
    )
    db.commit()
    db.refresh(doc)

    # Prefer queue; fall back to sync processing if Redis is down / local mode
    settings = get_settings()
    processed = False
    if settings.storage_backend != "local":
        try:
            enqueue_document_processing(str(doc.id), str(job.id))
            processed = True
        except Exception:
            processed = False
    if not processed:
        from app.services.pipeline import process_document

        try:
            process_document(db, doc.id, job.id)
        except Exception:
            pass
        db.refresh(doc)

    count = (
        db.query(func.count(Transaction.id))
        .filter(Transaction.document_id == doc.id)
        .scalar()
        or 0
    )
    return _doc_out(doc, int(count))
