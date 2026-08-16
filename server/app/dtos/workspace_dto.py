import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class WorkspaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    kind: str
    role: str = "owner"
    created_at: datetime
    updated_at: datetime


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(default="New workspace", min_length=1, max_length=120)
    kind: str = Field(default="personal", pattern="^(personal|team)$")


class WorkspaceUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class WorkspaceMemberResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: EmailStr
    display_name: str
    role: str
    created_at: datetime


class WorkspaceMemberInviteRequest(BaseModel):
    email: EmailStr
    role: str = Field(default="editor", pattern="^(editor|viewer)$")


class WorkspaceMemberRoleRequest(BaseModel):
    role: str = Field(pattern="^(editor|viewer)$")


class WorkspaceMemoryCreate(BaseModel):
    key: str = Field(default="note", min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=2000)


class WorkspaceMemoryUpsert(BaseModel):
    value: str = Field(min_length=1, max_length=2000)


class WorkspaceMemoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    key: str
    value: str
    created_at: datetime
    updated_at: datetime


class WorkspaceSearchResult(BaseModel):
    kind: str
    id: uuid.UUID
    title: str
    snippet: str
    score: float
    document_id: uuid.UUID | None = None
    page_number: int | None = None
    status: str | None = None


class ActivityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    workspace_id: uuid.UUID
    actor_id: uuid.UUID
    event_type: str
    subject_type: str
    subject_id: uuid.UUID
    payload: dict
    created_at: datetime


class ProductEventRequest(BaseModel):
    event_type: str = Field(pattern="^onboarding\\.[a-z_]+$", max_length=60)
    subject_id: uuid.UUID | None = None
    payload: dict = Field(default_factory=dict)
