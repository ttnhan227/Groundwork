import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.dtos.job_dto import PersistedWorkflowResponse, ProcessingJobResponse
from app.models.enums import MessageRole


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


class ConversationCreate(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=160)
    document_ids: list[uuid.UUID] = Field(default_factory=list)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    document_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)


class ConversationResponse(BaseModel):
    id: uuid.UUID
    title: str
    document_ids: list[uuid.UUID]
    messages: list[MessageResponse] = []
    created_at: datetime
    updated_at: datetime


class ConversationResourceCreate(BaseModel):
    resource_type: str = Field(pattern="^(document|artifact)$")
    resource_id: uuid.UUID
    role: str = Field(default="context", pattern="^(context|source|output)$")


class ConversationResourceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    conversation_id: uuid.UUID
    resource_type: str
    resource_id: uuid.UUID
    role: str
    created_at: datetime


class ChatRequest(BaseModel):
    question: str = Field(min_length=2, max_length=4000)


class ChatResponse(BaseModel):
    answer: str
    citations: list[CitationResponse]


class ConversationCommandRequest(BaseModel):
    client_message_id: uuid.UUID
    command: str = Field(min_length=3, max_length=2000)
    document_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)


class ConversationCommandResponse(BaseModel):
    message_id: uuid.UUID
    planner_run_id: uuid.UUID
    workflow: "PersistedWorkflowResponse"
    job: "ProcessingJobResponse | None" = None
