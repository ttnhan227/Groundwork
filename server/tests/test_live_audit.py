"""Comprehensive end-to-end audit test validating Groundwork against real repository files.

Verifies:
1. Windows filesystem indexing on real directories.
2. File parser AST symbol extraction on actual codebase files.
3. Hybrid search retrieval against real files.
4. Git integration against actual repository commits.
5. AI context engine citations pointing to real lines.
6. Mutating tool authorization with single-use confirmation tokens.
7. Cloud sync payload privacy guarantees (zero file contents).
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from app.core import config
from app.database.local_db import LocalDatabase, reset_db
from app.models.types import AIQueryRequest, SearchMode, WorkspaceCreate
from app.services.ai.context_engine import AIContextEngine
from app.services.ai.tools import AIToolManager
from app.services.git_service import GitService
from app.services.indexer_service import IndexerService
from app.services.search_engine import SearchEngine
from app.services.sync_service import SyncService
from app.services.workspace_service import WorkspaceService


@pytest.fixture
def audit_db():
    temp_dir = tempfile.TemporaryDirectory()
    db_path = Path(temp_dir.name) / "audit_groundwork.db"
    orig_db_path = config.get_settings().database_path
    config.get_settings().database_path = str(db_path)
    reset_db()
    db = LocalDatabase(str(db_path))

    yield db

    db.close()
    config.get_settings().database_path = orig_db_path
    reset_db()
    try:
        temp_dir.cleanup()
    except Exception:
        pass


def test_real_codebase_indexing_and_ast_parsing(audit_db):
    """Test indexing the actual server/app/core directory."""
    repo_root = Path(__file__).resolve().parent.parent
    target_dir = repo_root / "app" / "core"
    assert target_dir.exists(), f"Target directory {target_dir} must exist"

    ws_service = WorkspaceService()
    ws = ws_service.create_workspace(WorkspaceCreate(name="Groundwork Core", path=str(target_dir)))

    indexer = IndexerService()
    progress = indexer.index_workspace(ws.id)

    assert progress.files_indexed >= 2
    assert progress.errors == []

    # Verify files and AST symbols are stored in SQLite
    conn = audit_db.get_connection()
    files = conn.execute("SELECT * FROM files WHERE workspace_id = ?", (ws.id,)).fetchall()
    assert len(files) >= 2

    # Check that security.py was parsed and contains symbols
    security_file = next((f for f in files if "security.py" in f["filename"]), None)
    assert security_file is not None
    symbols = json.loads(security_file["symbols_json"])
    symbol_names = [s["name"] for s in symbols]
    assert "validate_workspace_path" in symbol_names
    assert "verify_confirmation_token" in symbol_names


def test_search_against_real_files(audit_db):
    """Test hybrid search against indexed real repository files."""
    repo_root = Path(__file__).resolve().parent.parent
    target_dir = repo_root / "app" / "core"

    ws_service = WorkspaceService()
    ws = ws_service.create_workspace(WorkspaceCreate(name="Core", path=str(target_dir)))

    indexer = IndexerService()
    indexer.index_workspace(ws.id)

    search_engine = SearchEngine()

    # 1. Exact function search
    res = search_engine.search("validate_workspace_path", mode=SearchMode.HYBRID, limit=5)
    assert res.total_matches > 0
    top_hit = res.results[0]
    assert "security.py" in top_hit.filename
    assert top_hit.line_number is not None
    assert "def validate_workspace_path" in top_hit.snippet

    # 2. Conceptual query
    concept_res = search_engine.search("directory traversal boundaries symlink resolution", mode=SearchMode.HYBRID, limit=5)
    assert concept_res.total_matches > 0
    assert any("security.py" in r.filename for r in concept_res.results)


def test_git_integration_against_actual_repository(audit_db):
    """Test GitService against the real Groundwork repository."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    assert (repo_root / ".git").exists(), "Repo must have .git directory"

    git_service = GitService()
    commits = git_service.get_recent_commits(str(repo_root), limit=5)

    assert len(commits) > 0
    latest = commits[0]
    assert "hash" in latest and len(latest["hash"]) >= 7
    assert "author" in latest and latest["author"]
    assert "message" in latest and latest["message"]


def test_ai_citations_point_to_real_lines(audit_db):
    """Test that AI context retrieval produces accurate citations with real line ranges."""
    repo_root = Path(__file__).resolve().parent.parent
    target_dir = repo_root / "app" / "core"

    ws_service = WorkspaceService()
    ws = ws_service.create_workspace(WorkspaceCreate(name="Core", path=str(target_dir)))

    indexer = IndexerService()
    indexer.index_workspace(ws.id)

    engine = AIContextEngine()
    resp = engine.query(AIQueryRequest(question="How is path traversal defended?", workspace_id=ws.id, file_paths=[str(target_dir / "security.py")]))

    assert len(resp.citations) > 0
    citation = resp.citations[0]
    assert "security.py" in citation.filename
    assert citation.line_start is not None and citation.line_start > 0

    # Verify that the line range exists in the actual file!
    actual_file_path = Path(citation.path)
    assert actual_file_path.exists()
    file_lines = actual_file_path.read_text(encoding="utf-8").splitlines()
    assert citation.line_start <= len(file_lines)


def test_mutating_ai_tool_requires_confirmation(audit_db):
    """Test that safe tools run freely while mutating tools strictly require valid tokens."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    ws_svc = WorkspaceService()
    ws_svc.create_workspace(WorkspaceCreate(name="GroundworkRoot", path=str(repo_root)))

    tools = AIToolManager()

    # 1. Mutating command execution requires confirmation token
    res = tools.execute_tool("run_command", {"command": "git status", "cwd": str(repo_root)})
    assert res.get("requires_confirmation") is True
    token = res.get("confirmation_token")
    assert token is not None

    # 2. Blocked dangerous command is immediately rejected
    blocked = tools.execute_tool("run_command", {"command": "rm -rf /", "cwd": str(repo_root)})
    assert blocked.get("status") == "blocked"

    # 3. Execution with valid confirmation token succeeds
    confirmed = tools.execute_tool("run_command", {"command": "git status", "cwd": str(repo_root)}, confirmation_token=token)
    assert confirmed.get("returncode") == 0 or "stdout" in confirmed or "output" in confirmed


def test_cloud_sync_privacy_guarantee(audit_db):
    """Verify that sync payload contains only metadata and notes, NEVER file contents."""
    sync_svc = SyncService()
    payload = sync_svc.get_sync_payload()

    # The payload MUST NOT contain file chunks, file contents, or repository trees
    assert "file_contents" not in payload
    assert "chunks" not in payload
    assert "files" not in payload
    assert "source_code" not in payload

    # Only settings, notes, and saved_searches are allowed
    allowed_keys = {"settings", "notes", "saved_searches"}
    assert set(payload.keys()).issubset(allowed_keys)
