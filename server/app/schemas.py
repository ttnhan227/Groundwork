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


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=100, max_length=10000)


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: EmailStr
    display_name: str
    role: UserRole
    is_active: bool
    google_linked: bool
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
            "pdf_to_docx|docx_to_pdf|docx_to_markdown|compress_pdf|add_page_numbers|workflow)$"
        )
    )
    parameters: dict

    @field_validator("parameters")
    @classmethod
    def limit_parameters(cls, value: dict) -> dict:
        if len(str(value)) > 20_000:
            raise ValueError("Job parameters are too large")
        return value


class WorkflowPlanRequest(BaseModel):
    command: str = Field(min_length=3, max_length=2000)
    document_id: uuid.UUID


class WorkflowExecuteRequest(WorkflowPlanRequest):
    approved: bool = False


class WorkflowStep(BaseModel):
    id: str
    tool: str
    title: str
    parameters: dict
    risk: str
    confirmation_required: bool
    verification: str


class WorkflowPlanResponse(BaseModel):
    id: uuid.UUID
    status: str
    command: str
    document_id: uuid.UUID
    steps: list[WorkflowStep]
    confirmation_required: bool
    estimated_ai_calls: int


class ConversationCommandRequest(BaseModel):
    client_message_id: uuid.UUID
    command: str = Field(min_length=3, max_length=2000)
    document_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)


class PersistedWorkflowStep(BaseModel):
    id: uuid.UUID
    position: int
    capability: str
    title: str
    parameters: dict
    risk: str
    verification: str
    status: str


class PersistedWorkflowResponse(BaseModel):
    id: uuid.UUID
    status: str
    confirmation_required: bool
    job_id: uuid.UUID | None
    steps: list[PersistedWorkflowStep]


class ConversationCommandResponse(BaseModel):
    message_id: uuid.UUID
    planner_run_id: uuid.UUID
    workflow: PersistedWorkflowResponse
    job: ProcessingJobResponse | None = None


class WorkflowEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    workflow_id: uuid.UUID
    event_type: str
    payload: dict
    created_at: datetime


class ConversationCreate(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=160)
    document_ids: list[uuid.UUID] = Field(default_factory=list)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    document_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)


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


class WorkspaceMemoryUpsert(BaseModel):
    value: str = Field(min_length=1, max_length=2000)


class WorkspaceMemoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    key: str
    value: str
    created_at: datetime
    updated_at: datetime


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


class ProfileUpdateRequest(BaseModel):
    display_name: str = Field(min_length=2, max_length=120)


class UserPreferences(BaseModel):
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
    recent_documents: list[DocumentResponse]
    recent_jobs: list[ProcessingJobResponse]


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


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: uuid.UUID
    workspace_id: uuid.UUID | None
    kind: str
    title: str
    message: str
    severity: str
    action: str | None
    subject_type: str | None
    subject_id: uuid.UUID | None
    metadata_json: dict
    read_at: datetime | None
    created_at: datetime


class NotificationCountResponse(BaseModel):
    unread: int


class WorkspaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    kind: str
    role: str = "owner"
    created_at: datetime
    updated_at: datetime


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


class NativeDocumentCreateRequest(BaseModel):
    title: str = Field(default="Untitled client report", min_length=1, max_length=180)
    source_document_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class NativeDocumentUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    content: dict
    revision: int = Field(ge=1)
    status: str = Field(default="draft", pattern="^(draft|review|complete)$")
    change_summary: str | None = Field(default=None, max_length=240)


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


class WorkspaceSearchResult(BaseModel):
    kind: str
    id: uuid.UUID
    title: str
    snippet: str
    score: float
    document_id: uuid.UUID | None = None
    page_number: int | None = None
    status: str | None = None
