"""SQLAlchemy Database Models and Enums for Groundwork."""

from app.models.chat import (
    Citation,
    Conversation,
    ConversationResource,
    Message,
)
from app.models.deliverable import (
    AIResult,
    AISuggestion,
    ArtifactVersion,
    DeliverableRequirement,
    DeliverableReviewFinding,
    DocumentComment,
    GeneratedArtifact,
    NativeDocument,
    NativeDocumentSource,
    NativeDocumentVersion,
)
from app.models.document import (
    Collection,
    Document,
    DocumentChunk,
    DocumentPage,
    conversation_documents,
)
from app.models.enums import (
    AIFeature,
    DocumentStatus,
    JobStatus,
    MessageRole,
    UserRole,
)
from app.models.job import (
    PlannerRun,
    ProcessingJob,
    ToolExecution,
    WorkflowEvent,
    WorkflowRun,
    WorkflowStepRun,
)
from app.models.notification import Notification
from app.models.usage import AIUsageRecord
from app.models.user import RefreshToken, User
from app.models.workspace import (
    ActivityEvent,
    Workspace,
    WorkspaceMember,
    WorkspaceMemory,
)

__all__ = [
    # Enums
    "UserRole",
    "DocumentStatus",
    "JobStatus",
    "MessageRole",
    "AIFeature",
    # User & Auth
    "User",
    "RefreshToken",
    # Workspace
    "Workspace",
    "WorkspaceMember",
    "WorkspaceMemory",
    "ActivityEvent",
    # Document
    "Document",
    "DocumentPage",
    "DocumentChunk",
    "Collection",
    "conversation_documents",
    # Chat & Conversation
    "Conversation",
    "Message",
    "Citation",
    "ConversationResource",
    # Jobs & Workflows
    "ProcessingJob",
    "PlannerRun",
    "WorkflowRun",
    "WorkflowStepRun",
    "ToolExecution",
    "WorkflowEvent",
    # Deliverables & Artifacts
    "NativeDocument",
    "NativeDocumentVersion",
    "NativeDocumentSource",
    "DocumentComment",
    "AISuggestion",
    "DeliverableRequirement",
    "DeliverableReviewFinding",
    "GeneratedArtifact",
    "ArtifactVersion",
    "AIResult",
    # Notifications & Usage
    "Notification",
    "AIUsageRecord",
]
