from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.ai_processing_job import AIProcessingJob, JobStatus
from app.models.document import Document, DocumentStatus
from app.models.transaction import Transaction
from app.services.ai_extract import extract_transactions_from_text, parse_amount
from app.services.categories import org_category_slugs, seed_system_categories
from app.services.merchants import seed_system_merchants
from app.services.parsers import parser_method_label
from app.services.pdf_extract import (
    attach_bbox_meta,
    extract_page_layouts,
    extract_pdf_pages,
    find_source_page,
)
from app.services.rules import resolve_category
from app.services.statement_balance import extract_stated_closing_balance, tie_out_balances
from app.services.storage import download_bytes


def process_document(db: Session, document_id: UUID, job_id: UUID) -> None:
    settings = get_settings()
    job = db.get(AIProcessingJob, job_id)
    document = db.get(Document, document_id)
    if not job or not document:
        return

    job.status = JobStatus.RUNNING
    job.attempts += 1
    job.started_at = datetime.now(timezone.utc)
    document.status = DocumentStatus.PROCESSING
    document.error_message = None
    db.commit()

    meta: dict[str, Any] = {}
    try:
        seed_system_categories(db)
        seed_system_merchants(db)
        pdf_bytes = download_bytes(document.s3_key)
        pages, used_ocr = extract_pdf_pages(pdf_bytes)
        layouts = [] if used_ocr else extract_page_layouts(pdf_bytes)
        page_count = len(pages)
        text = "\n\n".join(t for _, t in pages).strip()
        document.page_count = page_count

        if not text.strip():
            raise ValueError(
                "Could not extract text from this PDF. "
                "If it is a scan, ensure OCR is available, then use Reprocess."
            )

        run = extract_transactions_from_text(
            text,
            category_slugs=org_category_slugs(db, document.organization_id),
        )
        result = run.result
        document.bank_name = result.bank_name

        method = run.method
        if method == "heuristic":
            method = parser_method_label(result.bank_name)

        db.query(Transaction).filter(Transaction.document_id == document.id).delete()

        saved = 0
        dropped_bad_date = 0
        dropped_no_amount = 0
        last_balance: Optional[Decimal] = None
        pages_mapped = 0
        cat_from_rules = 0
        cat_from_ai = 0
        cat_other = 0
        merchants_matched = 0
        # Baseline: what AI/heuristic alone would have chosen (before merchant/rules)
        baseline_other = 0

        for item in result.transactions:
            try:
                tx_date = date.fromisoformat(item.transaction_date[:10])
            except ValueError:
                dropped_bad_date += 1
                continue

            debit = parse_amount(item.debit)
            credit = parse_amount(item.credit)
            balance = parse_amount(item.balance)
            if debit is None and credit is None:
                dropped_no_amount += 1
                continue

            ai_slug = (item.category or "other").strip().lower()
            if ai_slug == "other" or not ai_slug:
                baseline_other += 1

            category, from_rule, merchant = resolve_category(
                db,
                organization_id=document.organization_id,
                description=item.description,
                ai_category_slug=item.category,
            )
            if from_rule:
                cat_from_rules += 1
            elif category.slug == "other":
                cat_other += 1
            else:
                cat_from_ai += 1
            if merchant:
                merchants_matched += 1

            confidence = Decimal(str(round(item.confidence_score, 4)))
            needs_review = (
                (not from_rule and float(confidence) < settings.confidence_review_threshold)
                or category.slug == "other"
            )

            page_number = item.page_number
            source_meta: dict[str, Any] = {}
            if page_number is None:
                page_number, source_meta = find_source_page(
                    description=item.description,
                    transaction_date=item.transaction_date,
                    pages=pages,
                    layouts=layouts,
                )
            elif layouts:
                source_meta = attach_bbox_meta(
                    layouts,
                    page_number=page_number,
                    description=item.description,
                    transaction_date=item.transaction_date,
                )
            if page_number is not None:
                pages_mapped += 1

            extraction_source = item.extraction_source or method

            db.add(
                Transaction(
                    organization_id=document.organization_id,
                    client_id=document.client_id,
                    document_id=document.id,
                    bank_account_id=document.bank_account_id,
                    category_id=category.id,
                    merchant_id=merchant.id if merchant else None,
                    transaction_date=tx_date,
                    description=item.description.strip(),
                    debit=debit,
                    credit=credit,
                    balance=balance,
                    reference=item.reference,
                    confidence_score=confidence,
                    needs_review=needs_review,
                    raw_json=item.model_dump(),
                    page_number=page_number,
                    extraction_source=extraction_source,
                    source_meta_json=source_meta or None,
                )
            )
            saved += 1
            if balance is not None:
                last_balance = balance

        dropped_rows = dropped_bad_date + dropped_no_amount
        stated_closing = extract_stated_closing_balance(text)
        tie = tie_out_balances(stated_closing, last_balance)

        meta = {
            "page_count": page_count,
            "used_ocr": used_ocr,
            "method": method,
            "ai_fallback": run.ai_fallback,
            "provider_errors": run.provider_errors,
            "text_truncated": run.text_truncated,
            "text_chars": len(text),
            "raw_extracted_count": len(result.transactions),
            "transaction_count": saved,
            "dropped_rows": dropped_rows,
            "dropped_bad_date": dropped_bad_date,
            "dropped_no_amount": dropped_no_amount,
            "pages_mapped": pages_mapped,
            "bank_name": result.bank_name,
            "categorization": {
                "from_rules_or_merchants": cat_from_rules,
                "from_ai_heuristic": cat_from_ai,
                "other": cat_other,
                "merchants_matched": merchants_matched,
                "baseline_other_before_rules": baseline_other,
                "other_after_rules": cat_other,
                "other_reduction": max(baseline_other - cat_other, 0),
                "other_rate_before": round(baseline_other / saved, 4) if saved else 0,
                "other_rate_after": round(cat_other / saved, 4) if saved else 0,
            },
            **tie,
        }
        document.extraction_meta_json = meta

        if saved == 0:
            raise ValueError(
                "No transactions could be extracted from this PDF "
                f"(method={method}, text_chars={len(text)}, "
                f"raw_candidates={len(result.transactions)}, dropped={dropped_rows}). "
                "Use Reprocess after fixing the file, or try a clearer statement export."
            )

        document.status = DocumentStatus.READY
        warning = None
        if tie["tie_out"] == "mismatch":
            warning = (
                f"Extracted {saved} transactions, but closing balance does not match "
                f"(stated {tie['stated_closing']} vs ledger {tie['ledger_closing']}). "
                "Review before relying on this export."
            )
        document.error_message = warning
        job.status = JobStatus.SUCCEEDED
        job.finished_at = datetime.now(timezone.utc)
        job.meta_json = meta
        job.error = None

        from app.services.audit import AuditAction, write_audit

        write_audit(
            db,
            organization_id=document.organization_id,
            user_id=None,
            client_id=document.client_id,
            action=AuditAction.DOCUMENT_EXTRACTION_COMPLETED,
            entity_type="document",
            entity_id=str(document.id),
            after={
                "status": DocumentStatus.READY.value,
                "transaction_count": saved,
                "bank_name": document.bank_name,
                "method": meta.get("method") if isinstance(meta, dict) else None,
            },
            meta={
                "tie_out": tie.get("tie_out"),
                "dropped_rows": dropped_rows,
            },
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        job = db.get(AIProcessingJob, job_id)
        document = db.get(Document, document_id)
        if job:
            job.status = JobStatus.FAILED
            job.error = str(exc)[:2000]
            job.finished_at = datetime.now(timezone.utc)
            if meta:
                job.meta_json = meta
        if document:
            document.status = DocumentStatus.FAILED
            document.error_message = str(exc)[:2000]
            if meta:
                document.extraction_meta_json = meta
            db.query(Transaction).filter(Transaction.document_id == document.id).delete()
        db.commit()
        raise
