"""Tests for bounded AI context engine, provider fallback, and tool security boundaries."""

import tempfile
from pathlib import Path

from app.core import config
from app.models.types import AIQueryRequest, WorkspaceCreate
from app.services.ai.context_engine import AIContextEngine
from app.services.ai.tools import AIToolManager
from app.services.indexer_service import IndexerService
from app.services.workspace_service import WorkspaceService


def test_bounded_ai_context_retrieval_and_citations():
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir).resolve()
        db_path = root / "test_ai.db"
        config._settings = config.Settings(database_path=db_path, data_dir=root, ai_provider="local")

        # Setup test workspace with a file
        doc_file = root / "auth_policy.md"
        doc_file.write_text("""# Authentication Policy
Groundwork enforces JWT token validation and local workspace scoping.
Mutating actions require explicit user confirmation.
""")

        ws_svc = WorkspaceService()
        ws = ws_svc.create_workspace(WorkspaceCreate(name="Docs", path=str(root)))
        IndexerService.get_instance().index_single_file(doc_file, ws.id)

        engine = AIContextEngine()
        res = engine.query(AIQueryRequest(question="How does authentication policy work?"))

        assert res.evidence_count >= 1
        assert len(res.citations) >= 1
        assert res.citations[0].filename == "auth_policy.md"
        assert res.provider_used == "offline"
        assert "JWT" in res.answer or "Authentication Policy" in res.answer
        from app.database.local_db import reset_db
        reset_db()


def test_ai_tool_manager_safe_vs_mutating():
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir).resolve()
        db_path = root / "test_tools.db"
        config._settings = config.Settings(database_path=db_path, data_dir=root)

        ws_svc = WorkspaceService()
        ws_svc.create_workspace(WorkspaceCreate(name="ToolsWS", path=str(root)))

        tool_mgr = AIToolManager()

        # 1. Mutating command execution requires confirmation
        res = tool_mgr.execute_tool("run_command", {"command": "pytest tests/test_search_engine.py", "cwd": str(root)})
        assert res.get("requires_confirmation") is True
        token = res.get("confirmation_token")
        assert token is not None

        # 2. Blocked dangerous command
        blocked_res = tool_mgr.execute_tool("run_command", {"command": "rm -rf /", "cwd": str(root)})
        assert blocked_res.get("status") == "blocked"
        from app.database.local_db import reset_db
        reset_db()
