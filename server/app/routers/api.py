"""FastAPI routers for Groundwork Local API."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.database.local_db import get_db
from app.models.types import (
    ActivityItem,
    AIQueryRequest,
    AIQueryResponse,
    ContextSessionCreate,
    ContextSessionResponse,
    ContextSessionUpdate,
    IndexProgress,
    InvestigationRequest,
    NoteCreate,
    NoteResponse,
    ProjectOverview,
    ProjectResponse,
    SavedSearchCreate,
    SavedSearchResponse,
    SearchResponse,
    ToolExecutionRequest,
    WorkspaceCreate,
    WorkspaceResponse,
)
from app.services.activity_service import ActivityService
from app.services.ai.context_engine import AIContextEngine
from app.services.ai.investigation import InvestigationService
from app.services.ai.tools import AIToolManager
from app.services.context_service import ContextService
from app.services.git_service import GitService
from app.services.indexer_service import IndexerService
from app.services.notes_service import NotesService
from app.services.project_service import ProjectService
from app.services.saved_search_service import SavedSearchService
from app.services.search_engine import SearchEngine
from app.services.sync_service import SyncService
from app.services.system_service import SystemService
from app.services.workspace_service import WorkspaceService

# --- System Router ---
system_router = APIRouter(prefix="/api/system", tags=["System"])


@system_router.get("/local-ai")
def local_ai_status():
    from app.services.local_ai_service import LocalAIService
    return LocalAIService.instance().status()


class LocalAIAction(BaseModel):
    action: str
    model: str = "small"
    path: str = ""


@system_router.post("/local-ai")
def local_ai_action(req: LocalAIAction):
    from app.services.local_ai_service import LocalAIService
    service = LocalAIService.instance()
    try:
        if req.action == "install":
            service.install(req.model)
        elif req.action == "import":
            return service.import_model(req.path, req.model if req.model != "small" else None)
        elif req.action == "select":
            service.select(req.model)
        elif req.action == "cancel-download":
            service.cancel_download.set()
        elif req.action == "cancel-answer":
            service.cancel()
        elif req.action == "unload":
            if not service.generation_lock.acquire(blocking=False):
                raise ValueError("Cancel the current answer before freeing AI memory.")
            try:
                service.unload()
            finally:
                service.generation_lock.release()
        else:
            raise ValueError("Unknown AI action")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return service.status()


class PathActionRequest(BaseModel):
    path: str



@system_router.get("/duplicates")
def get_duplicates(workspace_id: str | None = None):
    from app.services.duplicate_service import DuplicateService
    return DuplicateService().find_duplicates(workspace_id)


@system_router.get("/capabilities")
def get_capabilities():
    from app.services.media_metadata import CapabilitiesService
    return CapabilitiesService.get_capabilities()


@system_router.get("/media-metadata")
def get_media_metadata(path: str):
    from app.core.security import validate_workspace_path
    from app.services.media_metadata import read_audio_metadata
    try:
        target = validate_workspace_path(path, WorkspaceService().get_allowed_roots())
        if not target.is_file():
            raise HTTPException(status_code=404, detail="This file is no longer available.")
        return read_audio_metadata(target)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="Choose a file inside an added folder.") from exc

@system_router.get("/file-storage")
def get_file_storage(path: str):
    from app.core.security import validate_workspace_path
    from app.services.storage_metadata import file_storage
    try:
        target = validate_workspace_path(path, WorkspaceService().get_allowed_roots())
        return file_storage(target)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="Choose an accessible file inside an added folder.") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="This file is no longer available.") from exc
    except OSError as exc:
        raise HTTPException(status_code=503, detail="Storage information is unavailable for this file.") from exc


@system_router.get("/status")
def get_system_status() -> dict[str, Any]:
    db = get_db()
    conn = db.get_connection()
    ws_count = conn.execute("SELECT COUNT(*) as count FROM workspaces;").fetchone()["count"]
    proj_count = conn.execute("SELECT COUNT(*) as count FROM projects;").fetchone()["count"]
    from app.services.inventory_service import InventoryService
    InventoryService()
    file_count = conn.execute("SELECT COUNT(DISTINCT path) as count FROM inventory WHERE kind = 'file';").fetchone()["count"]
    chunk_count = conn.execute("SELECT COUNT(*) as count FROM chunks;").fetchone()["count"]
    note_count = conn.execute("SELECT COUNT(*) as count FROM notes;").fetchone()["count"]

    return {
        "status": "ready",
        "app_name": get_settings().app_name,
        "app_version": get_settings().app_version,
        "database_path": str(get_settings().get_database_path()),
        "counts": {
            "workspaces": ws_count,
            "projects": proj_count,
            "files": file_count,
            "chunks": chunk_count,
            "notes": note_count,
        },
    }


@system_router.get("/readable-formats")
def readable_formats() -> dict[str, Any]:
    from app.services.file_parser import TEXT_EXTENSIONS
    return {"extensions": sorted(TEXT_EXTENSIONS | {".pdf"}), "special_names": ["Dockerfile", "Makefile", "LICENSE", "README"], "max_bytes": 5 * 1024 * 1024, "max_files": 6, "lines_per_file": 40}


@system_router.get("/computer")
def computer_status() -> dict[str, Any]:
    from app.services.desktop_actions import health
    return health()


class DesktopActionRequest(BaseModel):
    action: str
    value: str = Field(default="", max_length=2048)
    confirmation_token: str | None = None


@system_router.get("/installed-apps")
def installed_apps(refresh: bool = False):
    from app.services.installed_apps import list_apps
    try:
        return list_apps(refresh)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@system_router.post("/installed-apps/launch")
def launch_installed_app(req: PathActionRequest):
    from app.services.installed_apps import launch_app
    try:
        return launch_app(req.path)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Windows couldn't launch this app.") from exc


@system_router.post("/desktop-action")
def desktop_action(req: DesktopActionRequest) -> dict[str, Any]:
    from app.core.security import consume_confirmation_token, generate_confirmation_token
    from app.services.desktop_actions import APPS, perform
    if req.action not in {"app", "website", "screenshot", "screenshot-open"} or req.action == "app" and req.value not in APPS:
        raise HTTPException(status_code=422, detail="Unknown action")
    details = {"action": req.action, "value": req.value}
    if req.action == "screenshot":
        if not req.confirmation_token:
            return {"confirmation_required": True, "confirmation_token": generate_confirmation_token("desktop", details)}
        confirmed = consume_confirmation_token(req.confirmation_token)
        if not confirmed or confirmed["action_type"] != "desktop" or confirmed["details"] != details:
            raise HTTPException(status_code=403, detail="Confirmation expired; try again")
    try:
        return perform(req.action, req.value)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@system_router.post("/open-file")
def open_file_action(req: PathActionRequest) -> dict[str, Any]:
    svc = SystemService()
    try:
        ok = svc.open_file(req.path)
        return {"success": ok}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@system_router.post("/open-folder")
def open_folder_action(req: PathActionRequest) -> dict[str, Any]:
    svc = SystemService()
    try:
        ok = svc.open_folder(req.path)
        return {"success": ok}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@system_router.post("/reveal-file")
def reveal_file_action(req: PathActionRequest) -> dict[str, Any]:
    svc = SystemService()
    try:
        ok = svc.reveal_in_explorer(req.path)
        return {"success": ok}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --- Workspaces Router ---
workspaces_router = APIRouter(prefix="/api/workspaces", tags=["Workspaces"])


@workspaces_router.get("", response_model=list[WorkspaceResponse])
def list_workspaces() -> list[WorkspaceResponse]:
    return WorkspaceService().list_workspaces()


@workspaces_router.post("", response_model=WorkspaceResponse)
def create_workspace(data: WorkspaceCreate) -> WorkspaceResponse:
    try:
        ws = WorkspaceService().create_workspace(data)
        # Automatically trigger background indexing
        IndexerService.get_instance().start_indexing(ws.id)
        return ws
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@workspaces_router.get("/inventory/all")
def browse_all_inventory(query: str = "", extension: str = "", sort: str = "size", descending: bool = True, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500), category: str = "", modified_after: float | None = None) -> dict[str, Any]:
    from app.core.file_categories import LABELS
    from app.services.inventory_service import InventoryService
    if sort not in {"name", "size", "modified", "type"} or category and category not in LABELS:
        raise HTTPException(status_code=422, detail="Unknown inventory filter")
    return InventoryService().browse(None, query=query, extension=extension, sort=sort, descending=descending, offset=offset, limit=limit, category=category, kind="file", modified_after=modified_after)


@workspaces_router.get("/{workspace_id}/inventory")
def browse_inventory(workspace_id: str, parent: str | None = None, query: str = "", extension: str = "", sort: str = "name", descending: bool = False, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500), category: str = "", recursive: bool = False, kind: str = "", min_size: int | None = Query(None, ge=0), modified_after: float | None = None) -> dict[str, Any]:
    from app.services.inventory_service import InventoryService
    if not WorkspaceService().get_workspace(workspace_id):
        raise HTTPException(status_code=404, detail="Folder not found")
    if sort not in {"name", "size", "modified", "type"}:
        raise HTTPException(status_code=422, detail="Unknown sort")
    from app.core.file_categories import LABELS
    if category and category not in LABELS:
        raise HTTPException(status_code=422, detail="Unknown storage category")
    if kind and kind not in {"file", "folder"}:
        raise HTTPException(status_code=422, detail="Unknown inventory kind")
    return InventoryService().browse(workspace_id, parent, query, extension, sort, descending, offset, limit, category, recursive, kind, min_size, modified_after)


@workspaces_router.get("/{workspace_id}", response_model=WorkspaceResponse)
def get_workspace(workspace_id: str) -> WorkspaceResponse:
    ws = WorkspaceService().get_workspace(workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws


@workspaces_router.delete("/{workspace_id}")
def delete_workspace(workspace_id: str) -> dict[str, bool]:
    ok = WorkspaceService().delete_workspace(workspace_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {"deleted": True}


# --- Projects Router ---
projects_router = APIRouter(prefix="/api/projects", tags=["Projects"])


@projects_router.get("", response_model=list[ProjectResponse])
def list_projects(workspace_id: str | None = None) -> list[ProjectResponse]:
    return ProjectService().list_projects(workspace_id)


@projects_router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str) -> ProjectResponse:
    proj = ProjectService().get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


@projects_router.get("/{project_id}/overview", response_model=ProjectOverview)
def get_project_overview(project_id: str) -> ProjectOverview:
    overview = ProjectService().get_project_overview(project_id)
    if not overview:
        raise HTTPException(status_code=404, detail="Project not found")
    return overview


# --- Indexer Router ---
indexer_router = APIRouter(prefix="/api/index", tags=["Indexer"])


@indexer_router.post("/start", response_model=IndexProgress)
def start_indexing(workspace_id: str | None = None, paths: list[str] | None = None) -> IndexProgress:
    return IndexerService.get_instance().start_indexing(workspace_id, target_paths=paths, resume=True)


@indexer_router.post("/selected", response_model=IndexProgress)
def index_selected(paths: list[str], workspace_id: str | None = None) -> IndexProgress:
    return IndexerService.get_instance().index_selected_paths(paths, workspace_id)


@indexer_router.get("/status", response_model=IndexProgress)
def get_indexing_status() -> IndexProgress:
    return IndexerService.get_instance().get_progress()


@indexer_router.post("/cancel", response_model=IndexProgress)
def cancel_indexing() -> IndexProgress:
    return IndexerService.get_instance().cancel_indexing()


# --- Search Router ---
search_router = APIRouter(prefix="/api/search", tags=["Search"])


@search_router.get("", response_model=SearchResponse)
def search_workspace(
    q: str = Query(..., description="Query terms or natural language search"),
    workspace_id: str | None = None,
    project_id: str | None = None,
    mode: str = Query(default="hybrid", enum=["hybrid", "lexical", "semantic", "filename"]),
    limit: int = Query(default=25, ge=1, le=100),
    file_type: str | None = None,
    modified_after: float | None = None,
) -> SearchResponse:
    if mode == "filename":
        from app.services.inventory_service import InventoryService
        return InventoryService().search(q, workspace_id, project_id, limit, file_type, modified_after)
    return SearchEngine().search(
        query=q,
        workspace_id=workspace_id,
        project_id=project_id,
        search_mode=mode,
        limit=limit,
        file_type=file_type,
        modified_after=modified_after,
    )


# --- Git Router ---
git_router = APIRouter(prefix="/api/git", tags=["Git"])


@git_router.get("/commits")
def get_git_commits(query: str | None = None, project_id: str | None = None, limit: int = 25) -> list[dict[str, Any]]:
    if query:
        return GitService().search_commits(query, project_id, limit)
    return GitService().search_commits("", project_id, limit)


# --- Activity Router ---
@git_router.get("/projects/{project_id}/file-history")
def get_file_history(project_id: str, path: str, limit: int = Query(default=20, ge=1, le=100)) -> dict[str, Any]:
    project = ProjectService().get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        return GitService().get_file_history(Path(project.path), path, limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


activity_router = APIRouter(prefix="/api/activity", tags=["Activity"])


@activity_router.get("", response_model=list[ActivityItem])
def list_activities(project_id: str | None = None, days: int = 7) -> list[ActivityItem]:
    return ActivityService().list_activities(project_id=project_id, days=days)


@activity_router.get("/summary")
def get_activity_summary(days: int = 2) -> dict[str, Any]:
    return ActivityService().get_what_was_i_doing_summary(days=days)


# --- Context Sessions Router ---
context_router = APIRouter(prefix="/api/context-sessions", tags=["ContextSessions"])


@context_router.get("", response_model=list[ContextSessionResponse])
def list_sessions(project_id: str | None = None) -> list[ContextSessionResponse]:
    return ContextService().list_sessions(project_id)


@context_router.post("", response_model=ContextSessionResponse)
def create_session(data: ContextSessionCreate) -> ContextSessionResponse:
    return ContextService().create_session(data)


@context_router.get("/{session_id}", response_model=ContextSessionResponse)
def get_session(session_id: str) -> ContextSessionResponse:
    sess = ContextService().get_session(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    return sess


@context_router.put("/{session_id}", response_model=ContextSessionResponse)
def update_session(session_id: str, updates: ContextSessionUpdate) -> ContextSessionResponse:
    sess = ContextService().update_session(session_id, updates.model_dump(exclude_unset=True, exclude_none=True))
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    return sess


# --- Notes Router ---
notes_router = APIRouter(prefix="/api/notes", tags=["Notes"])


@notes_router.get("", response_model=list[NoteResponse])
def list_notes(project_id: str | None = None, q: str | None = None) -> list[NoteResponse]:
    return NotesService().list_notes(project_id, q)


@notes_router.post("", response_model=NoteResponse)
def create_note(data: NoteCreate) -> NoteResponse:
    return NotesService().create_note(data)


@notes_router.get("/{note_id}", response_model=NoteResponse)
def get_note(note_id: str) -> NoteResponse:
    note = NotesService().get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@notes_router.put("/{note_id}", response_model=NoteResponse)
def update_note(note_id: str, data: dict[str, Any]) -> NoteResponse:
    note = NotesService().update_note(note_id, data)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@notes_router.delete("/{note_id}")
def delete_note(note_id: str) -> dict[str, bool]:
    ok = NotesService().delete_note(note_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"deleted": True}


# --- Saved Searches Router ---
saved_searches_router = APIRouter(prefix="/api/saved-searches", tags=["SavedSearches"])


@saved_searches_router.get("", response_model=list[SavedSearchResponse])
def list_saved_searches() -> list[SavedSearchResponse]:
    return SavedSearchService().list_saved_searches()


@saved_searches_router.post("", response_model=SavedSearchResponse)
def create_saved_search(data: SavedSearchCreate) -> SavedSearchResponse:
    return SavedSearchService().create_saved_search(data)


@saved_searches_router.delete("/{search_id}")
def delete_saved_search(search_id: str) -> dict[str, bool]:
    ok = SavedSearchService().delete_saved_search(search_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Saved search not found")
    return {"deleted": True}


# --- AI Router ---
ai_router = APIRouter(prefix="/api/ai", tags=["AI"])


@ai_router.post("/jobs/query")
def query_ai_job(req: AIQueryRequest):
    from app.services.assistant_jobs import AssistantJobs
    try:
        return AssistantJobs.start(lambda: AIContextEngine().query(req))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@ai_router.get("/jobs/{job_id}")
def assistant_job(job_id: str):
    from app.services.assistant_jobs import AssistantJobs
    try:
        return AssistantJobs.get(job_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


class OrganizationRequest(BaseModel):
    action: str
    paths: list[str] = Field(default_factory=list, max_length=100)
    items: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    destination: str = ""
    instruction: str = Field(default="", max_length=2000)
    provider: str = "builtin"
    plan_id: str = ""
    approved: bool = False
    rule_type: str = ""
    rule_id: str = ""
    rule_name: str = ""
    categories: list[str] = Field(default_factory=list)


class AssistantActionRequest(BaseModel):
    instruction: str = Field(default="", max_length=2000)
    paths: list[str] = Field(default_factory=list, max_length=6)
    proposal: dict[str, Any] | None = None
    confirmation_token: str | None = None


@ai_router.post("/actions/propose")
def propose_assistant_action(req: AssistantActionRequest):
    from app.services.assistant_actions import propose
    from app.services.assistant_jobs import AssistantJobs
    try:
        return AssistantJobs.start(lambda: propose(req.instruction, req.paths))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@ai_router.post("/actions/execute")
def execute_assistant_action(req: AssistantActionRequest):
    from app.services.assistant_actions import execute
    try:
        if not req.proposal or not req.confirmation_token:
            raise ValueError("Review and approve the proposed action first.")
        return execute(req.proposal, req.confirmation_token)
    except (ValueError, PermissionError, FileNotFoundError) as exc:
        raise HTTPException(400, str(exc)) from exc


@ai_router.get("/organization/history")
def organization_history():
    from app.services.organization_service import OrganizationService
    return OrganizationService().history()


@ai_router.get("/organization/progress")
def organization_progress():
    from app.services.organization_service import OrganizationService
    return dict(OrganizationService.progress)


@ai_router.post("/organization")
def organize(req: OrganizationRequest):
    from app.services.assistant_jobs import AssistantJobs
    from app.services.organization_service import OrganizationService
    service = OrganizationService()
    try:
        if req.action == "cancel":
            return service.cancel()
        if req.action == "suggest":
            return AssistantJobs.start(lambda: service.suggest(req.paths, req.instruction, req.provider))
        if req.action == "simple_rule":
            return AssistantJobs.start(lambda: service.apply_simple_rule(req.items, req.rule_type, req.categories))
        if req.action == "preview":
            return AssistantJobs.start(lambda: service.preview(req.items, req.destination, req.instruction))
        if req.action in {"execute", "undo"}:
            if not req.approved:
                raise ValueError("Review the preview and explicitly approve before moving files.")
            return AssistantJobs.start(lambda: service.execute(req.plan_id, True, undo=req.action == "undo"))
        if req.action == "save_rule":
            return service.save_rule(req.destination, req.rule_name, req.rule_type, req.instruction, req.categories)
        if req.action == "list_rules":
            return service.list_rules(req.destination or None)
        if req.action == "get_rule":
            return service.get_rule(req.rule_id)
        if req.action == "delete_rule":
            return {"success": service.delete_rule(req.rule_id)}
        if req.action == "run_rule":
            return AssistantJobs.start(lambda: service.run_saved_rule(req.rule_id, req.destination or None))
        if req.action == "save_preference":
            return service.save_preference(req.rule_name, req.categories, req.instruction)
        if req.action == "list_preferences":
            return service.list_preferences()
        if req.action == "delete_preference":
            return {"success": service.delete_preference(req.rule_id)}
        if req.action == "create_sample":
            return service.create_sample_folder()
        raise ValueError("Unknown organization action")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@ai_router.get("/organization/rules")
def list_organization_rules(folder: str | None = None):
    from app.services.organization_service import OrganizationService
    return OrganizationService().list_rules(folder)


@ai_router.get("/organization/preferences")
def list_organization_preferences():
    from app.services.organization_service import OrganizationService
    return OrganizationService().list_preferences()


@ai_router.post("/organization/sample")
def create_organization_sample():
    from app.services.organization_service import OrganizationService
    return OrganizationService().create_sample_folder()


@ai_router.post("/query", response_model=AIQueryResponse)
def query_ai(req: AIQueryRequest) -> AIQueryResponse:
    try:
        return AIContextEngine().query(req)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@ai_router.post("/investigate")
def run_investigation(req: InvestigationRequest) -> dict[str, Any]:
    try:
        return InvestigationService().run_investigation(req)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@ai_router.get("/tools")
def list_ai_tools() -> list[dict[str, Any]]:
    return AIToolManager().get_tool_definitions()


@ai_router.post("/tools/execute")
def execute_ai_tool(req: ToolExecutionRequest) -> dict[str, Any]:
    return AIToolManager().execute_tool(req.tool_name, req.arguments, req.confirmation_token)


@ai_router.get("/providers")
def list_providers() -> list[dict[str, Any]]:
    settings = get_settings()
    return [
        {"id": "builtin", "name": "Built-in AI (on this computer)", "is_local": True, "active": settings.ai_provider == "builtin"},
        {"id": "local", "name": "Local workspace excerpts", "is_local": True, "active": settings.ai_provider == "local"},
        {"id": "ollama", "name": "Ollama (On-Device Local LLM)", "is_local": True, "active": settings.ai_provider == "ollama"},
        {"id": "openai", "name": "OpenAI (Cloud)", "is_local": False, "active": settings.ai_provider == "openai"},
        {"id": "gemini", "name": "Google Gemini (Cloud)", "is_local": False, "active": settings.ai_provider == "gemini"},
    ]


# --- Sync Router ---
sync_router = APIRouter(prefix="/api/sync", tags=["Sync"])


@sync_router.get("/status")
def get_sync_status() -> dict[str, Any]:
    return SyncService().get_sync_status()


@sync_router.post("/trigger")
def trigger_sync() -> dict[str, Any]:
    return SyncService().trigger_sync()


class PreferencesUpdate(BaseModel):
    ai_provider: str | None = None
    ollama_base_url: str | None = None
    ollama_model: str | None = None
    openai_model: str | None = None
    gemini_model: str | None = None
    openai_api_key: str | None = None
    gemini_api_key: str | None = None


@system_router.get("/preferences")
def get_preferences():
    from app.services.preferences_service import PreferencesService
    return PreferencesService().public()


@system_router.put("/preferences")
def update_preferences(req: PreferencesUpdate):
    from app.services.preferences_service import PreferencesService
    values = req.model_dump(exclude_unset=True)
    if values.get("ai_provider") not in {None, "local", "ollama", "openai", "gemini"}:
        raise HTTPException(status_code=422, detail="Unknown provider")
    if any((value is None and key not in {"openai_api_key", "gemini_api_key"}) or (value is not None and (not isinstance(value, str) or not value or len(value) > 4096)) for key, value in values.items()):
        raise HTTPException(status_code=422, detail="Invalid preferences")
    try:
        return PreferencesService().update(values)
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class CloudLoginRequest(BaseModel):
    url: str | None = None
    email: str
    password: str
    create_account: bool = Field(default=False, alias="register")


class GoogleStartRequest(BaseModel):
    url: str | None = None
    link: bool = False


class GoogleSessionRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)


@sync_router.post("/google/start")
def google_start(req: GoogleStartRequest):
    from app.services.google_signin_service import start_google
    try:
        return start_google(req.url or get_settings().cloud_sync_url, req.link)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@sync_router.post("/google/poll")
def google_poll(req: GoogleSessionRequest):
    from app.services.google_signin_service import poll_google
    return poll_google(req.session_id)


@sync_router.post("/google/cancel")
def google_cancel(req: GoogleSessionRequest):
    from app.services.google_signin_service import cancel_google
    return cancel_google(req.session_id)


@sync_router.post("/login")
def cloud_login(req: CloudLoginRequest):
    import httpx

    from app.services.preferences_service import PreferencesService, validate_url
    try:
        url = validate_url(req.url or get_settings().cloud_sync_url)
        with httpx.Client(timeout=15) as client:
            response = client.post(f"{url}/auth/{'register' if req.create_account else 'login'}", json={"email": req.email, "password": req.password})
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Cloud sign-in failed; check your credentials")
            token = response.json()["access_token"]
        PreferencesService().update({"cloud_sync_url": url, "cloud_sync_token": token, "cloud_sync_enabled": True})
        return {"status": "authenticated"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Unable to sign in to cloud sync") from exc


@sync_router.post("/logout")
def cloud_logout():
    from app.services.preferences_service import PreferencesService
    PreferencesService().update({"cloud_sync_token": None, "cloud_sync_enabled": False})
    return {"status": "local_only"}


@system_router.post("/shutdown")
def shutdown_core(request: Request):
    callback = getattr(request.app.state, "request_shutdown", None)
    if callback is None:
        raise HTTPException(status_code=503, detail="This development server is not managed by Groundwork")
    callback()
    return {"status": "stopping"}
