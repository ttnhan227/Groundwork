"""FastAPI routers for Groundwork Local API."""

from __future__ import annotations

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


class PathActionRequest(BaseModel):
    path: str


@system_router.get("/status")
def get_system_status() -> dict[str, Any]:
    db = get_db()
    conn = db.get_connection()
    ws_count = conn.execute("SELECT COUNT(*) as count FROM workspaces;").fetchone()["count"]
    proj_count = conn.execute("SELECT COUNT(*) as count FROM projects;").fetchone()["count"]
    file_count = conn.execute("SELECT COUNT(*) as count FROM files;").fetchone()["count"]
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
def start_indexing(workspace_id: str | None = None) -> IndexProgress:
    return IndexerService.get_instance().start_indexing(workspace_id)


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
    from pathlib import Path
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
