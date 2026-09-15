import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class NoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    owner_id: uuid.UUID
    title: str
    content: str
    note_type: str = "user"
    source_id: uuid.UUID | None = None
    source_title: str | None = None
    page_number: int | None = None
    message_id: uuid.UUID | None = None
    citations: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class NoteCreateRequest(BaseModel):
    title: str = Field(default="Untitled Note", max_length=180)
    content: str = Field(default="")
    note_type: str = Field(default="user", pattern="^(user|saved_answer|excerpt|studio_output)$")
    source_id: uuid.UUID | None = None
    source_title: str | None = None
    page_number: int | None = None
    message_id: uuid.UUID | None = None
    citations: list[dict[str, Any]] = Field(default_factory=list)


class NoteUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=180)
    content: str | None = None
    note_type: str | None = Field(default=None, pattern="^(user|saved_answer|excerpt|studio_output)$")
    citations: list[dict[str, Any]] | None = None
