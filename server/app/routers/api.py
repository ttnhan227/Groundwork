"""FastAPI routers for Groundwork Local API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.config import get_settings
from app.database.local_db import get_db
from app.models.types import (
    ActivityItem,
    AIQueryRequest,
    AIQueryResponse,
    ContextSessionCreate,
    ContextSessionResponse,
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
) -> SearchResponse:
    return SearchEngine().search(
        query=q,
        workspace_id=workspace_id,
        project_id=project_id,
        search_mode=mode,
        limit=limit,
    )


# --- Git Router ---
git_router = APIRouter(prefix="/api/git", tags=["Git"])


@git_router.get("/commits")
def get_git_commits(query: str | None = None, project_id: str | None = None, limit: int = 25) -> list[dict[str, Any]]:
    if query:
        return GitService().search_commits(query, project_id, limit)
    conn = get_db().get_connection()
    sql = "SELECT c.*, p.name as project_name FROM git_commits c JOIN projects p ON c.project_id = p.id"
    params: list[Any] = []
    if project_id:
        sql += " WHERE c.project_id = ?"
        params.append(project_id)
    sql += " ORDER BY c.date DESC LIMIT ?;"
    params.append(limit)
    rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


# --- Activity Router ---
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
def update_session(session_id: str, updates: dict[str, Any]) -> ContextSessionResponse:
    sess = ContextService().update_session(session_id, updates)
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
    return AIContextEngine().query(req)


@ai_router.post("/investigate")
def run_investigation(req: InvestigationRequest) -> dict[str, Any]:
    return InvestigationService().run_investigation(req)


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
        {"id": "local", "name": "Local Deterministic Synthesizer", "is_local": True, "active": settings.ai_provider == "local"},
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
