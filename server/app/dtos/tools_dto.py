import uuid

from pydantic import BaseModel, Field


class SummaryRequest(BaseModel):
    style: str = Field(default="short", pattern="^(short|detailed|key_points|action_items)$")


class QuizRequest(BaseModel):
    question_count: int = Field(default=5, ge=1, le=20)


class ExtractionRequest(BaseModel):
    categories: list[str] = Field(
        default=["people", "dates", "companies", "monetary_values", "deadlines", "action_items"],
        min_length=1,
        max_length=12,
    )
    custom_fields: list[str] = Field(default=[], max_length=10)


class TranslationRequest(BaseModel):
    target_language: str = Field(min_length=2, max_length=60)
    page_numbers: list[int] | None = Field(default=None, max_length=100)
    format: str = Field(default="markdown", pattern="^(plain_text|markdown)$")


class ComparisonRequest(BaseModel):
    left_document_id: uuid.UUID
    right_document_id: uuid.UUID

