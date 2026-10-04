"""Domain models, enums, and request/response DTOs for Groundwork Local."""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class ActivityType(str, Enum):
    FILE_MODIFIED = "file_modified"
    FILE_CREATED = "file_created"
    FILE_DELETED = "file_deleted"
    GIT_COMMIT = "git_commit"
    PROJECT_OPENED = "project_opened"
    NOTE_CREATED = "note_created"
    INVESTIGATION_STARTED = "investigation_started"
    SEARCH_EXECUTED = "search_executed"


class IndexStatus(str, Enum):
    IDLE = "idle"
    INDEXING = "indexing"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


# --- Workspace & Project DTOs ---

class WorkspaceCreate(BaseModel):
    name: str
    path: str
    ignore_patterns: list[str] = Field(default_factory=list)


class WorkspaceResponse(BaseModel):
    id: str
    name: str
    path: str
    is_active: bool = True
    ignore_patterns: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class ProjectResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    path: str
    detected_type: str
    language: str
    frameworks: list[str] = Field(default_factory=list)
    git_remote: str | None = None
    git_branch: str | None = None
    last_modified: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProjectOverview(ProjectResponse):
    working_tree: dict[str, Any] = Field(default_factory=dict)
    readme_preview: str | None = None
    entry_points: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    recent_commits: list[dict[str, Any]] = Field(default_factory=list)
    key_files: list[dict[str, Any]] = Field(default_factory=list)


class SearchMode(str, Enum):
    HYBRID = "hybrid"
    LEXICAL = "lexical"
    SEMANTIC = "semantic"
    FILENAME = "filename"


# --- Search DTOs ---

class SearchRequest(BaseModel):
    query: str
    mode: SearchMode = SearchMode.HYBRID
    project_id: str | None = None
    limit: int = 25


class SearchResultItem(BaseModel):
    file_id: str
    path: str
    filename: str
    relative_path: str
    project_id: str | None = None
    project_name: str | None = None
    file_type: str
    line_number: int | None = None
    snippet: str
    matched_terms: list[str] = Field(default_factory=list)
    score: float
    score_breakdown: dict[str, float] = Field(default_factory=dict)
    last_modified: str | None = None
    git_context: dict[str, Any] | None = None


class SearchResponse(BaseModel):
    query: str
    total_matches: int
    results: list[SearchResultItem]
    duration_ms: float
    search_mode: str = "hybrid"


# --- Indexer DTOs ---

class IndexProgress(BaseModel):
    run_id: str | None = None
    status: IndexStatus = IndexStatus.IDLE
    current_workspace: str | None = None
    files_discovered: int = 0
    files_indexed: int = 0
    files_skipped: int = 0
    percent: float = 0.0
    current_file: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    errors: list[str] = Field(default_factory=list)


# --- Activity & Context Session DTOs ---

class ActivityCreate(BaseModel):
    workspace_id: str | None = None
    project_id: str | None = None
    activity_type: ActivityType
    summary: str
    details: dict[str, Any] = Field(default_factory=dict)


class ActivityItem(BaseModel):
    id: str
    workspace_id: str | None = None
    project_id: str | None = None
    project_name: str | None = None
    activity_type: ActivityType
    summary: str
    details: dict[str, Any] = Field(default_factory=dict)
    timestamp: str


class ContextSessionCreate(BaseModel):
    title: str
    project_id: str | None = None
    summary: str | None = None
    files_inspected: list[str] = Field(default_factory=list)
    git_commits: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    todos: list[str] = Field(default_factory=list)
    last_command: str | None = None


class ContextSessionResponse(BaseModel):
    id: str
    title: str
    project_id: str | None = None
    project_name: str | None = None
    status: str = "active"
    started_at: str
    last_active_at: str
    files_inspected: list[str] = Field(default_factory=list)
    git_commits: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    todos: list[str] = Field(default_factory=list)
    last_command: str | None = None
    summary: str | None = None


class ContextSessionUpdate(BaseModel):
    title: str | None = None
    status: Literal["active", "paused", "completed"] | None = None
    summary: str | None = None
    files_inspected: list[str] | None = None
    git_commits: list[str] | None = None
    notes: list[str] | None = None
    todos: list[str] | None = None
    last_command: str | None = None


# --- Notes & Saved Searches DTOs ---

class NoteCreate(BaseModel):
    title: str
    content: str
    project_id: str | None = None
    file_path: str | None = None
    tags: list[str] = Field(default_factory=list)


class NoteResponse(BaseModel):
    id: str
    title: str
    content: str
    project_id: str | None = None
    project_name: str | None = None
    file_path: str | None = None
    tags: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str
    sync_status: str = "synced"


class SavedSearchCreate(BaseModel):
    title: str
    query: str
    filters: dict[str, Any] = Field(default_factory=dict)


class SavedSearchResponse(BaseModel):
    id: str
    title: str
    query: str
    filters: dict[str, Any] = Field(default_factory=dict)
    created_at: str


# --- AI DTOs ---

class AIQueryRequest(BaseModel):
    session_id: str | None = None
    question: str = Field(min_length=1, max_length=12000)
    focused_path: str | None = None
    file_paths: list[str] = Field(default_factory=list, max_length=6)
    focused_line: int = Field(default=1, ge=1, le=10000000)
    project_id: str | None = None
    workspace_id: str | None = None
    include_git: bool = True
    provider: str | None = None


class CitationItem(BaseModel):
    path: str
    filename: str
    line_start: int | None = None
    line_end: int | None = None
    snippet: str


class AIQueryResponse(BaseModel):
    answer: str
    citations: list[CitationItem]
    evidence_count: int
    provider_used: str
    suggested_actions: list[dict[str, Any]] = Field(default_factory=list)
    session_id: str | None = None


class InvestigationRequest(BaseModel):
    provider: str | None = None
    problem_statement: str = Field(min_length=1, max_length=12000)
    project_id: str | None = None
    files: list[str] = Field(default_factory=list, max_length=6)
    focused_line: int = Field(default=1, ge=1, le=10000000)
    session_id: str | None = None
    recent_errors: list[str] = Field(default_factory=list, max_length=20)


class ToolExecutionRequest(BaseModel):
    tool_name: str
    arguments: dict[str, Any]
    confirmation_token: str | None = None


# --- System DTOs ---

class SystemStatusResponse(BaseModel):
    status: str = "ok"
    app_name: str = "Groundwork Local"
    app_version: str = "0.1.0"
    database_path: str
    counts: dict[str, int] = Field(default_factory=dict)

