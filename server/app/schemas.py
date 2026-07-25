import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import DocumentStatus, JobStatus, MessageRole, UserRole


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=2, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: EmailStr
    display_name: str
    role: UserRole
    is_active: bool
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    status: DocumentStatus
    page_count: int | None
    error_message: str | None
    created_at: datetime


class DocumentRenameRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=180)


class DocumentPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    page_number: int
    text: str
    extraction_method: str


class ProcessingJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    document_id: uuid.UUID | None
    operation: str
    parameters: dict
    status: JobStatus
    progress: int
    retry_count: int
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    result_kind: str | None
    result_id: uuid.UUID | None
    created_at: datetime


class OperationJobCreate(BaseModel):
    operation: str = Field(
        pattern=(
            "^(summary|quiz|extraction|translation|comparison|merge|split|rotate|"
            "delete_pages|extract_pages|pdf_to_images|images_to_pdf|watermark|"
            "pdf_to_docx|docx_to_pdf|docx_to_markdown)$"
        )
    )
    parameters: dict

    @field_validator("parameters")
    @classmethod
    def limit_parameters(cls, value: dict) -> dict:
        if len(str(value)) > 20_000:
            raise ValueError("Job parameters are too large")
        return value


class ConversationCreate(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=160)
    document_ids: list[uuid.UUID] = Field(min_length=1)


class ConversationUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=160)


class CitationResponse(BaseModel):
    document_id: uuid.UUID
    document_name: str
    page_number: int
    snippet: str


class MessageResponse(BaseModel):
    id: uuid.UUID
    role: MessageRole
    content: str
    citations: list[CitationResponse] = []
    created_at: datetime


class ConversationResponse(BaseModel):
    id: uuid.UUID
    title: str
    document_ids: list[uuid.UUID]
    messages: list[MessageResponse] = []
    created_at: datetime
    updated_at: datetime


class ChatRequest(BaseModel):
    question: str = Field(min_length=2, max_length=4000)


class ChatResponse(BaseModel):
    answer: str
    citations: list[CitationResponse]


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


class AIResultResponse(BaseModel):
    id: uuid.UUID
    feature: str
    document_ids: list[uuid.UUID]
    parameters: dict
    result: dict
    cached: bool
    created_at: datetime


class MergeRequest(BaseModel):
    document_ids: list[uuid.UUID] = Field(min_length=2, max_length=20)


class PageOperationRequest(BaseModel):
    document_id: uuid.UUID
    page_numbers: list[int] = Field(min_length=1, max_length=500)


class RotateRequest(PageOperationRequest):
    degrees: int = Field(default=90)


class SplitRequest(BaseModel):
    document_id: uuid.UUID
    mode: str = Field(pattern="^(ranges|every_page|selected)$")
    ranges: list[str] = Field(default=[], max_length=50)
    page_numbers: list[int] = Field(default=[], max_length=500)


class PDFToImagesRequest(BaseModel):
    document_id: uuid.UUID
    page_numbers: list[int] | None = Field(default=None, max_length=500)
    format: str = Field(default="png", pattern="^(png|jpeg)$")
    dpi: int = Field(default=144, ge=72, le=300)


class ArtifactResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    operation: str
    filename: str
    content_type: str
    size_bytes: int
    parameters: dict
    created_at: datetime


class ArtifactRenameRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)


class ProfileUpdateRequest(BaseModel):
    display_name: str = Field(min_length=2, max_length=120)


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class UserStatsResponse(BaseModel):
    document_count: int
    page_count: int
    storage_bytes: int
    ai_requests: int
    generated_files: int
    failed_jobs: int


class DashboardResponse(UserStatsResponse):
    recent_documents: list[DocumentResponse]
    recent_jobs: list[ProcessingJobResponse]


class AdminUserResponse(UserResponse):
    document_count: int
    storage_bytes: int
    ai_requests: int


class UserStatusRequest(BaseModel):
    is_active: bool
