import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class NativeDocumentCreateRequest(BaseModel):
    title: str = Field(default="Untitled client report", min_length=1, max_length=180)
    source_document_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class NativeDocumentUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    content: dict
    revision: int = Field(ge=1)
    status: str = Field(default="draft", pattern="^(draft|review|complete)$")
    change_summary: str | None = Field(default=None, max_length=240)


class NativeDocumentBlocksRequest(BaseModel):
    blocks: list[dict] = Field(default_factory=list)


class NativeDocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    workspace_id: uuid.UUID
    owner_id: uuid.UUID
    title: str
    content: dict
    status: str
    revision: int
    source_document_ids: list[uuid.UUID] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class NativeDocumentVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    native_document_id: uuid.UUID
    version_number: int
    title: str
    content: dict
    change_summary: str | None
    created_by: uuid.UUID
    created_at: datetime


class NativeDocumentSourceRequest(BaseModel):
    document_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class CommentCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    anchor: dict = Field(default_factory=dict)


class CommentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    native_document_id: uuid.UUID
    author_id: uuid.UUID
    body: str
    anchor: dict
    status: str
    created_at: datetime
    resolved_at: datetime | None


class SuggestionCreateRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=2000)
    before_text: str = Field(default="", max_length=100_000)
    proposed_text: str | None = Field(default=None, max_length=100_000)
    citations: list[dict] = Field(default_factory=list, max_length=100)


class SuggestionDecisionRequest(BaseModel):
    action: str = Field(pattern="^(accept|reject)$")


class SuggestionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    native_document_id: uuid.UUID
    created_by: uuid.UUID
    instruction: str
    before_text: str
    proposed_text: str
    status: str
    citations: list[dict]
    created_at: datetime
    decided_at: datetime | None


class RequirementCreateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    kind: str = Field(default="content", pattern="^(section|question|format|evidence|deadline|content)$")
    is_required: bool = True
    position: int = Field(default=0, ge=0, le=1000)


class RequirementUpdateRequest(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=2000)
    kind: str | None = Field(default=None, pattern="^(section|question|format|evidence|deadline|content)$")
    status: str | None = Field(default=None, pattern="^(pending|partial|covered|waived)$")
    is_required: bool | None = None
    position: int | None = Field(default=None, ge=0, le=1000)
    evidence: list[dict] | None = Field(default=None, max_length=100)
    linked_sections: list[str] | None = Field(default=None, max_length=30)


class RequirementExtractionRequest(BaseModel):
    source_document_id: uuid.UUID | None = None


class RequirementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    native_document_id: uuid.UUID
    created_by: uuid.UUID
    text: str
    kind: str
    status: str
    is_required: bool
    position: int
    origin: str
    evidence: list[dict]
    linked_sections: list[str]
    created_at: datetime
    updated_at: datetime


class ReviewRunRequest(BaseModel):
    focus: str = Field(default="", max_length=2000)


class ReviewFindingDecisionRequest(BaseModel):
    action: str = Field(pattern="^(accept|reject|resolve)$")


class ReviewFindingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    native_document_id: uuid.UUID
    requirement_id: uuid.UUID | None
    created_by: uuid.UUID
    kind: str
    claim_type: str
    severity: str
    claim_text: str
    explanation: str
    proposed_text: str
    citations: list[dict]
    status: str
    created_at: datetime
    decided_at: datetime | None


class DeliverableReadinessResponse(BaseModel):
    requirements_total: int
    requirements_covered: int
    requirements_required: int
    required_covered: int
    unsupported_claims: int
    open_findings: int
    unresolved_comments: int
    sources_linked: int
    sources_used: int
    status: str
    blockers: list[str]


class ArtifactResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    operation: str
    filename: str
    content_type: str
    size_bytes: int
    parameters: dict
    linked_document_id: uuid.UUID | None
    collection_id: uuid.UUID | None = None
    created_at: datetime


class ArtifactRenameRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)


class ArtifactVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    artifact_id: uuid.UUID
    version_number: int
    content_type: str
    size_bytes: int
    change_prompt: str | None
    metadata_json: dict
    created_at: datetime


class ArtifactVersionRestoreRequest(BaseModel):
    version_id: uuid.UUID


class AIResultResponse(BaseModel):
    id: uuid.UUID
    feature: str
    document_ids: list[uuid.UUID]
    parameters: dict
    result: dict
    cached: bool
    created_at: datetime
