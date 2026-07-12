from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from app.core.config import get_settings

ALLOWED_CATEGORY_SLUGS = {
    "sales",
    "customer-payments",
    "investment",
    "loan",
    "fuel",
    "salaries",
    "rent",
    "utilities",
    "marketing",
    "purchases",
    "taxes",
    "other",
}


class ExtractedTransaction(BaseModel):
    transaction_date: str = Field(description="ISO date YYYY-MM-DD if present")
    description: str
    debit: Optional[str] = None
    credit: Optional[str] = None
    balance: Optional[str] = None
    reference: Optional[str] = None
    category: str = Field(description="Category slug from allowed list")
    confidence_score: float = Field(ge=0, le=1)
    # Set by pipeline / parsers — optional for AI JSON compatibility
    page_number: Optional[int] = None
    extraction_source: Optional[str] = None

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        slug = v.strip().lower().replace(" ", "-")
        return slug or "other"


class ExtractionResult(BaseModel):
    bank_name: Optional[str] = None
    transactions: list[ExtractedTransaction]


class ExtractionRun(BaseModel):
    """Extraction result plus pilot trust metadata."""

    result: ExtractionResult
    method: str = "heuristic"  # heuristic | vertex | gemini | openai
    ai_fallback: bool = False
    provider_errors: list[str] = Field(default_factory=list)
    text_truncated: bool = False


def _build_extraction_schema(allowed_slugs: set[str]) -> dict[str, Any]:
    slugs = sorted(allowed_slugs | ALLOWED_CATEGORY_SLUGS)
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "bank_name": {"type": ["string", "null"]},
            "transactions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "transaction_date": {"type": "string"},
                        "description": {"type": "string"},
                        "debit": {"type": ["string", "null"]},
                        "credit": {"type": ["string", "null"]},
                        "balance": {"type": ["string", "null"]},
                        "reference": {"type": ["string", "null"]},
                        "category": {
                            "type": "string",
                            "enum": slugs,
                        },
                        "confidence_score": {"type": "number"},
                    },
                    "required": [
                        "transaction_date",
                        "description",
                        "debit",
                        "credit",
                        "balance",
                        "reference",
                        "category",
                        "confidence_score",
                    ],
                },
            },
        },
        "required": ["bank_name", "transactions"],
    }


EXTRACTION_SCHEMA: dict[str, Any] = _build_extraction_schema(ALLOWED_CATEGORY_SLUGS)

SYSTEM_PROMPT = """You are a financial document extraction engine for bank statements.
Extract ONLY transactions that appear in the provided document text.
Never invent, estimate, or hallucinate transactions, amounts, dates, or balances.
If a field is missing in the source, return null for that field.
Use ISO dates (YYYY-MM-DD) when the date can be determined.
Category must be one of the allowed slugs.
confidence_score must reflect extraction certainty (0-1).
If the document is not a bank statement or has no transactions, return an empty transactions array.
"""


def parse_amount(value: str | None) -> Decimal | None:
    if value is None or str(value).strip() == "":
        return None
    cleaned = (
        str(value)
        .replace(",", "")
        .replace(" ", "")
        .replace("$", "")
        .replace("PKR", "")
        .replace("USD", "")
        .strip()
    )
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = "-" + cleaned[1:-1]
    try:
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None


def extract_transactions_from_text(
    document_text: str,
    category_slugs: set[str] | None = None,
) -> ExtractionRun:
    settings = get_settings()
    provider = (settings.ai_provider or "auto").lower()
    truncated = document_text[:120_000]
    text_truncated = len(document_text) > 120_000
    allowed = set(ALLOWED_CATEGORY_SLUGS) | (category_slugs or set())

    use_vertex = provider in {"vertex", "auto"} and bool(
        settings.vertex_project_id and settings.google_application_credentials
    )
    use_gemini = provider in {"gemini", "auto"} and bool(
        settings.gemini_api_key or settings.vertex_api_key
    )
    use_openai = provider in {"openai", "auto"} and bool(
        settings.openai_api_key and not settings.openai_api_key.startswith("sk-your")
    )

    if provider == "heuristic" or (not use_vertex and not use_gemini and not use_openai):
        return ExtractionRun(
            result=_heuristic_extract(document_text),
            method="heuristic",
            ai_fallback=False,
            text_truncated=False,
        )

    errors: list[str] = []

    if use_vertex:
        try:
            return ExtractionRun(
                result=_vertex_extract(truncated, allowed),
                method="vertex",
                ai_fallback=False,
                text_truncated=text_truncated,
            )
        except Exception as exc:
            errors.append(f"vertex:{exc}")
            try:
                return ExtractionRun(
                    result=_vertex_extract(truncated, allowed),
                    method="vertex",
                    ai_fallback=False,
                    text_truncated=text_truncated,
                )
            except Exception as exc2:
                errors.append(f"vertex_retry:{exc2}")

    if use_gemini:
        try:
            return ExtractionRun(
                result=_gemini_extract(truncated, allowed),
                method="gemini",
                ai_fallback=False,
                text_truncated=text_truncated,
            )
        except Exception as exc:
            errors.append(f"gemini:{exc}")
            try:
                return ExtractionRun(
                    result=_gemini_extract(truncated, allowed),
                    method="gemini",
                    ai_fallback=False,
                    text_truncated=text_truncated,
                )
            except Exception as exc2:
                errors.append(f"gemini_retry:{exc2}")

    if use_openai:
        try:
            return ExtractionRun(
                result=_openai_extract(truncated, allowed),
                method="openai",
                ai_fallback=False,
                text_truncated=text_truncated,
            )
        except Exception as exc:
            errors.append(f"openai:{exc}")
            try:
                return ExtractionRun(
                    result=_openai_extract(truncated, allowed),
                    method="openai",
                    ai_fallback=False,
                    text_truncated=text_truncated,
                )
            except Exception as exc2:
                errors.append(f"openai_retry:{exc2}")

    return ExtractionRun(
        result=_heuristic_extract(document_text),
        method="heuristic",
        ai_fallback=True,
        provider_errors=errors[:5],
        text_truncated=text_truncated,
    )


def _openai_extract(truncated: str, allowed_slugs: set[str] | None = None) -> ExtractionResult:
    from openai import OpenAI

    settings = get_settings()
    schema = _build_extraction_schema(allowed_slugs or ALLOWED_CATEGORY_SLUGS)
    client = OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model=settings.openai_model,
        temperature=0,
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "bank_statement_extraction",
                "strict": True,
                "schema": schema,
            },
        },
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Bank statement text:\n\n{truncated}"},
        ],
    )
    content = response.choices[0].message.content or "{}"
    return ExtractionResult.model_validate(json.loads(content))


def _vertex_extract(truncated: str, allowed_slugs: set[str] | None = None) -> ExtractionResult:
    """Vertex AI Gemini via service account ADC."""
    import os
    from pathlib import Path

    settings = get_settings()
    creds = settings.google_application_credentials
    if not creds:
        raise RuntimeError("GOOGLE_APPLICATION_CREDENTIALS path not set")
    cred_path = Path(creds)
    if not cred_path.is_absolute():
        from app.core.config import ROOT

        cred_path = ROOT / cred_path
    if not cred_path.exists():
        raise RuntimeError(f"Service account file not found: {cred_path}")

    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(cred_path.resolve())

    import vertexai
    from vertexai.generative_models import GenerationConfig, GenerativeModel

    vertexai.init(project=settings.vertex_project_id, location=settings.vertex_location)
    model = GenerativeModel(
        settings.vertex_model,
        system_instruction=[SYSTEM_PROMPT],
    )
    schema = {
        "type": "object",
        "properties": {
            "bank_name": {"type": "string", "nullable": True},
            "transactions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "transaction_date": {"type": "string"},
                        "description": {"type": "string"},
                        "debit": {"type": "string", "nullable": True},
                        "credit": {"type": "string", "nullable": True},
                        "balance": {"type": "string", "nullable": True},
                        "reference": {"type": "string", "nullable": True},
                        "category": {
                            "type": "string",
                            "enum": sorted(allowed_slugs or ALLOWED_CATEGORY_SLUGS),
                        },
                        "confidence_score": {"type": "number"},
                    },
                    "required": [
                        "transaction_date",
                        "description",
                        "category",
                        "confidence_score",
                    ],
                },
            },
        },
        "required": ["transactions"],
    }
    response = model.generate_content(
        (
            "Extract transactions from this Pakistan bank statement. "
            "Amounts are PKR. Use ISO dates. Return JSON only.\n\n"
            f"{truncated}"
        ),
        generation_config=GenerationConfig(
            temperature=0,
            response_mime_type="application/json",
            response_schema=schema,
        ),
    )
    text = response.text or "{}"
    return ExtractionResult.model_validate(json.loads(text))


def _gemini_extract(truncated: str, allowed_slugs: set[str] | None = None) -> ExtractionResult:
    """Google AI Studio / Gemini API (AIza… keys). Not full Vertex IAM."""
    import httpx

    settings = get_settings()
    api_key = settings.gemini_api_key or settings.vertex_api_key
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY / VERTEX_API_KEY not set")
    model = settings.gemini_model
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent"
    )
    # Gemini REST JSON schema: avoid tuple types; use nullable via anyOf
    schema = {
        "type": "object",
        "properties": {
            "bank_name": {"type": "string", "nullable": True},
            "transactions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "transaction_date": {"type": "string"},
                        "description": {"type": "string"},
                        "debit": {"type": "string", "nullable": True},
                        "credit": {"type": "string", "nullable": True},
                        "balance": {"type": "string", "nullable": True},
                        "reference": {"type": "string", "nullable": True},
                        "category": {
                            "type": "string",
                            "enum": sorted(allowed_slugs or ALLOWED_CATEGORY_SLUGS),
                        },
                        "confidence_score": {"type": "number"},
                    },
                    "required": [
                        "transaction_date",
                        "description",
                        "category",
                        "confidence_score",
                    ],
                },
            },
        },
        "required": ["transactions"],
    }
    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "Extract transactions from this Pakistan bank statement. "
                            "Amounts are PKR. Use ISO dates. Return JSON only.\n\n"
                            f"{truncated}"
                        )
                    }
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": schema,
        },
    }
    with httpx.Client(timeout=120.0) as client:
        res = client.post(url, params={"key": api_key}, json=payload)
        res.raise_for_status()
        body = res.json()
    text = body["candidates"][0]["content"]["parts"][0]["text"]
    data = json.loads(text)
    return ExtractionResult.model_validate(data)


def _heuristic_extract(document_text: str) -> ExtractionResult:
    """Offline fallback — bank-specific parsers (Meezan, HBL, UBL) then generic."""
    from app.services.parsers import run_bank_parsers

    return run_bank_parsers(document_text)
