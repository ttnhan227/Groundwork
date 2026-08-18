import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import DocumentStatus


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    workspace_id: uuid.UUID | None = None
    filename: str
    content_type: str
    size_bytes: int
    status: DocumentStatus
    page_count: int | None
    error_message: str | None
    display_title: str | None = None
    original_filename: str | None = None
    original_content_type: str | None = None
    tags: list[str] = []
    collection_id: uuid.UUID | None = None
    created_at: datetime


class DocumentRenameRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=180)


class DocumentMetadataUpdate(BaseModel):
    display_title: str | None = Field(default=None, max_length=180)
    tags: list[str] = Field(default=[], max_length=12)
    collection_id: uuid.UUID | None = None

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(tag.strip().lower()[:40] for tag in value if tag.strip()))[:12]


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = Field(default="#3154d8", pattern=r"^#[0-9a-fA-F]{6}$")


class CollectionUpdate(CollectionCreate):
    pass


class CollectionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    color: str
    created_at: datetime


class ArchiveFileReference(BaseModel):
    kind: str = Field(pattern="^(document|artifact)$")
    id: uuid.UUID


class DocumentArchiveRequest(BaseModel):
    files: list[ArchiveFileReference] = Field(min_length=2, max_length=25)


class DocumentPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    page_number: int
    text: str
    extraction_method: str
