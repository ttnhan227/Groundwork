"""Regression checks for security failures demonstrated by the audit."""
import time

from app.core import security
from app.services.ai.tools import AIToolManager


def test_context_keeps_selected_sources_and_bounds_citation_lines(monkeypatch):
    from app.models.types import AIQueryRequest
    from app.services.ai import context_engine

    calls = []
    prompts = []
    class Tools:
        def execute_tool(self, name, args):
            calls.append((name, args))
            if name == "search_files":
                return {"results": []}
            if name == "read_file":
                return {"path": args["path"], "start_line": 10, "end_line": 49, "content": "\n".join(["evidence" * 200] * 40)}
            if name == "get_context_session":
                return {"notes": ["Remember the previous decision"], "todos": ["Verify the fix"]}
            raise AssertionError(name)
    class Provider:
        def generate(self, prompt, system_prompt):
            prompts.append(prompt)
            return "Bounded answer"
    monkeypatch.setattr(context_engine, "AIToolManager", Tools)
    monkeypatch.setattr(context_engine, "get_llm_provider", lambda name: Provider())
    result = context_engine.AIContextEngine().query(AIQueryRequest(question="Continue", file_paths=["selected.py"], focused_line=10, session_id="saved-session", include_git=False))
    assert calls == [("read_file", {"path": "selected.py", "start_line": 10, "end_line": 49})]
    assert len(result.citations[0].snippet) == 8000
    assert result.citations[0].line_end == 14
    assert "Remember the previous decision" not in prompts[0]
    assert "Verify the fix" not in prompts[0]


def test_shell_operators_and_mutating_git_are_blocked():
    for command in ["git status & echo unsafe", "git push", "pytestanything", "git -c alias.x=!echo x", "git diff --output=secret", "npm run arbitrary"]:
        assert not security.is_safe_command(command)[0]
    assert security.is_safe_command("git status --short")[0]


def test_search_filters_recent_results_and_trained_semantics(tmp_path, monkeypatch):
    import os
    import pytest
    from app.core import config
    from app.database.local_db import reset_db
    from app.models.types import WorkspaceCreate
    from app.services.indexer_service import IndexerService
    from app.services.search_engine import SearchEngine
    from app.services.workspace_service import WorkspaceService

    reset_db()
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "state.db", data_dir=tmp_path))
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "finance.md").write_text("Invoices must be settled within thirty days. Customers receive a reminder before the due date.", encoding="utf-8")
    (root / "garden.md").write_text("Plants grow in soil with sunlight and water. Flowers attract butterflies.", encoding="utf-8")
    code = root / "old.py"
    code.write_text("invoice_marker = True\n", encoding="utf-8")
    os.utime(code, (1000, 1000))
    ws = WorkspaceService().create_workspace(WorkspaceCreate(name="Filters", path=str(root)))
    try:
        IndexerService().index_workspace_sync(ws.id)
        search = SearchEngine()
        assert not search.search("invoice_marker", search_mode="lexical", modified_after=2000).results
        assert not search.search("invoice_marker", search_mode="lexical", file_type="document").results
        assert search.search("", search_mode="filename", limit=1).results[0].filename != "old.py"
        if search.embeddings.model_id != "minilm-l6-v2":
            pytest.skip("Run prepare-model.py for trained model verification")
        result = search.search("How are overdue payments collected?", search_mode="semantic")
        assert result.results[0].filename == "finance.md", result
    finally:
        reset_db()


def test_confirmation_is_expiring_and_single_use():
    token = security.generate_confirmation_token("create_note", {"title": "Review"})
    assert security.verify_confirmation_token(token)
    assert security.consume_confirmation_token(token)
    assert security.consume_confirmation_token(token) is None
    token = security.generate_confirmation_token("create_note", {})
    security._pending_confirmations[token]["created_at"] = time.monotonic() - 301
    assert not security.verify_confirmation_token(token)
    assert security.consume_confirmation_token(token) is None


def test_approved_command_cannot_be_substituted():
    manager = AIToolManager()
    probe = manager.execute_tool("run_command", {"command": "git status"})
    assert probe["status"] == "confirmation_required"
    result = manager.execute_tool("run_command", {"command": "git log"}, probe["confirmation_token"])
    assert result["status"] == "denied"


def test_mutating_tools_need_confirmation():
    manager = AIToolManager()
    for tool, args in [("create_note", {"title": "Review", "content": "body"}), ("open_file", {"path": "example.txt"})]:
        assert manager.execute_tool(tool, args)["status"] == "confirmation_required"


def test_indexing_content_changes_and_ignore_cleanup(tmp_path, monkeypatch):
    import os
    from app.core import config
    from app.database.local_db import get_db, reset_db
    from app.models.types import WorkspaceCreate
    from app.services.indexer_service import IndexerService
    from app.services.workspace_service import WorkspaceService

    reset_db()
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "state.db", data_dir=tmp_path))
    root = tmp_path / "workspace"
    root.mkdir()
    file = root / "example.py"
    file.write_text("value = 'before'\n", encoding="utf-8")
    workspace = WorkspaceService().create_workspace(WorkspaceCreate(name="Test", path=str(root)))
    indexer = IndexerService()
    try:
        assert indexer.index_single_file(file, workspace.id)
        original = file.stat()
        file.write_text("value = 'after!'\n", encoding="utf-8")
        os.utime(file, ns=(original.st_atime_ns, original.st_mtime_ns))
        assert indexer.index_single_file(file, workspace.id)
        (root / ".gitignore").write_text("example.py\n", encoding="utf-8")
        indexer.index_workspace_sync(workspace.id)
        assert not get_db().get_connection().execute("SELECT id FROM files WHERE path = ?", (str(file),)).fetchone()
        (root / ".gitignore").write_text("", encoding="utf-8")
        assert indexer.index_single_file(file, workspace.id)
        file.write_text("", encoding="utf-8")
        assert not indexer.index_single_file(file, workspace.id)
        assert not get_db().get_connection().execute("SELECT id FROM files WHERE path = ?", (str(file),)).fetchone()
    finally:
        reset_db()


def test_untrusted_browser_origin_is_rejected():
    from fastapi.testclient import TestClient
    from app.main import app
    response = TestClient(app).get("/api/workspaces", headers={"Origin": "https://untrusted.example"})
    assert response.status_code == 403


def test_private_preferences_are_encrypted_and_not_public(tmp_path, monkeypatch):
    import sys
    import pytest
    from app.core import config
    from app.services.preferences_service import PreferencesService
    if sys.platform != "win32":
        pytest.skip("Windows DPAPI persistence")
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "state.db", data_dir=tmp_path))
    service = PreferencesService()
    result = service.update({"openai_api_key": "private-test-key", "ai_provider": "openai"})
    assert "openai_api_key" not in result
    assert result["openai_api_key_configured"]
    assert b"private-test-key" not in service.path.read_bytes()
    config.get_settings().openai_api_key = None
    service.load()
    assert config.get_settings().openai_api_key == "private-test-key"


def test_sync_does_not_drop_unacknowledged_queue(tmp_path, monkeypatch):
    import httpx
    from app.core import config
    from app.database.local_db import get_db, reset_db
    from app.models.types import NoteCreate
    from app.services.notes_service import NotesService
    from app.services.sync_service import SyncService
    reset_db()
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "state.db", data_dir=tmp_path, CLOUD_SYNC_ENABLED=True, CLOUD_SYNC_TOKEN="test-token"))
    note = NotesService().create_note(NoteCreate(title="A note", content="User text", file_path="private/local/path.py"))
    real_client = httpx.Client
    def response(request):
        import json
        payload = json.loads(request.content)
        assert "file_path" not in payload["items"][0]["payload"]
        return httpx.Response(200, json={"status": "success", "processed_count": 0})
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(response)))
    try:
        result = SyncService().trigger_sync()
        assert result["status"] == "error"
        assert get_db().get_connection().execute("SELECT COUNT(*) FROM sync_queue").fetchone()[0] == 1
        assert NotesService().get_note(note.id).content == "User text"
    finally:
        reset_db()
