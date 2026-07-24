import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

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


class DocumentPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    page_number: int
    text: str
    extraction_method: str


class ProcessingJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    status: JobStatus
    progress: int
    retry_count: int
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None


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
