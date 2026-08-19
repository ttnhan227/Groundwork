import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.dtos.document_dto import DocumentResponse
from app.dtos.job_dto import ProcessingJobResponse
from app.models.enums import UserRole


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: EmailStr
    display_name: str
    role: UserRole
    is_active: bool
    google_linked: bool
    created_at: datetime


class ProfileUpdateRequest(BaseModel):
    display_name: str = Field(min_length=2, max_length=120)


class UserPreferences(BaseModel):
    language: str = Field(default="en", pattern="^(en|vi|es|ja|de|fr|zh|ko|pt)$")
    compact_sidebar: bool = False
    reduced_motion: bool = False
    default_export_format: str = Field(default="pdf", pattern="^(pdf|docx|markdown)$")
    document_language: str = Field(default="English", min_length=2, max_length=40)
    default_tone: str = Field(default="professional", pattern="^(professional|concise|technical|academic|friendly)$")
    citation_style: str = Field(default="inline", pattern="^(inline|footnote|apa|mla|chicago)$")
    page_size: str = Field(default="a4", pattern="^(a4|letter)$")
    theme: str = Field(default="light", pattern="^(light|dark|system)$")
    interface_size: str = Field(default="comfortable", pattern="^(compact|comfortable|large)$")
    high_contrast: bool = False
    notify_processing_completed: bool = True
    notify_processing_failed: bool = True
    notify_comments: bool = True
    notify_reviews: bool = True
    retain_activity_history: bool = True
    retention_days: int = Field(default=90, ge=7, le=3650)


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
    recent_documents: list["DocumentResponse"]
    recent_jobs: list["ProcessingJobResponse"]


class AdminUserResponse(UserResponse):
    document_count: int
    storage_bytes: int
    ai_requests: int


class UserStatusRequest(BaseModel):
    is_active: bool


class SecuritySessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    expires_at: datetime


class UsageDetailResponse(BaseModel):
    storage_limit_bytes: int
    storage_bytes: int
    ai_requests_total: int
    ai_requests_30_days: int
    ai_requests_by_feature: dict[str, int]
    jobs_by_status: dict[str, int]


class PrivacyConfirmationRequest(BaseModel):
    confirmation: str = Field(min_length=1, max_length=320)
