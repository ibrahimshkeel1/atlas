from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)
    organization_name: str = Field(min_length=1, max_length=255)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    full_name: str
    organization_id: UUID


class OrganizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str


class MeResponse(BaseModel):
    user: UserOut
    organization: OrganizationOut


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    type: str
    is_system: bool = True


class CategoryCreate(BaseModel):
    name: str
    type: str  # income | expense


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None


class CategoryDelete(BaseModel):
    reassign_to_id: Optional[UUID] = None


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    filename: str
    status: str
    page_count: Optional[int] = None
    error_message: Optional[str] = None
    bank_name: Optional[str] = None
    created_at: Optional[str] = None
    transaction_count: int = 0
    extraction_meta: Optional[dict] = None


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    document_id: UUID
    transaction_date: str
    description: str
    debit: Optional[Decimal] = None
    credit: Optional[Decimal] = None
    balance: Optional[Decimal] = None
    reference: Optional[str] = None
    category_id: Optional[UUID] = None
    category: Optional[CategoryOut] = None
    confidence_score: Optional[Decimal] = None
    needs_review: bool
    page_number: Optional[int] = None
    extraction_source: Optional[str] = None
    source_meta: Optional[dict] = None
    suggested_category: Optional[CategoryOut] = None
    rule_suggestion: Optional["RuleSuggestion"] = None


class RuleSuggestion(BaseModel):
    pattern: str
    category_id: UUID
    category_name: str
    preview: str
    merchant_name: Optional[str] = None


class MerchantAliasOut(BaseModel):
    id: UUID
    pattern: str
    match_type: str
    priority: int
    source: str


class MerchantOut(BaseModel):
    id: UUID
    name: str
    slug: str
    category_id: Optional[UUID] = None
    category: Optional[CategoryOut] = None
    is_system: bool = False
    client_id: Optional[UUID] = None
    aliases: list[MerchantAliasOut] = Field(default_factory=list)


class MerchantCreate(BaseModel):
    name: str
    category_id: Optional[UUID] = None
    aliases: list[str] = Field(default_factory=list)
    client_id: Optional[UUID] = None


class MerchantLearnRequest(BaseModel):
    description: str
    category_id: UUID
    merchant_name: Optional[str] = None
    client_id: Optional[UUID] = None
    also_create_category_rule: bool = True


class TransactionUpdate(BaseModel):
    category_id: Optional[UUID] = None
    needs_review: Optional[bool] = None


class BulkCategoryUpdate(BaseModel):
    transaction_ids: list[UUID] = Field(min_length=1)
    category_id: UUID


class BulkReviewUpdate(BaseModel):
    transaction_ids: list[UUID] = Field(min_length=1)
    needs_review: bool = False


class BulkApproveHighConfidence(BaseModel):
    transaction_ids: Optional[list[UUID]] = None
    document_id: Optional[UUID] = None
    min_confidence: Optional[float] = None


class DashboardSummary(BaseModel):
    total_income: Decimal
    total_expenses: Decimal
    net_cash_flow: Decimal
    transaction_count: int
    needs_review_count: int = 0
    top_expense_categories: list[dict]
    monthly_trends: list[dict]


class ReportRequest(BaseModel):
    report_type: str
    period_start: str
    period_end: str
    format: str = "xlsx"
    force: bool = False


class ExportRequest(BaseModel):
    format: str = "xlsx"
    period_start: Optional[str] = None
    period_end: Optional[str] = None


class CategoryRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    pattern: str
    match_type: str
    category_id: UUID
    category: Optional[CategoryOut] = None
    priority: int


class CategoryRuleUpdate(BaseModel):
    category_id: Optional[UUID] = None
    pattern: Optional[str] = None
    priority: Optional[int] = None


class CategoryRuleCreate(BaseModel):
    pattern: str = Field(min_length=2, max_length=512)
    category_id: UUID
    match_type: str = "contains"
    priority: int = 10


class ReviewStatus(BaseModel):
    period_start: str
    period_end: str
    transaction_count: int
    needs_review_count: int
    reviewed_count: int
    is_locked: bool
    can_export: bool
    period_key: Optional[str] = None


class PeriodCloseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    period_key: str
    period_start: str
    period_end: str
    locked_at: str


class PeriodCloseRequest(BaseModel):
    period_key: str = Field(description="YYYY-MM")
