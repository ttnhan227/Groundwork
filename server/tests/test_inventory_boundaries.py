import os

import pytest

from app.core import config
from app.database.local_db import reset_db
from app.models.types import AIQueryRequest, WorkspaceCreate
from app.services.ai.context_engine import AIContextEngine
from app.services.inventory_service import InventoryService
from app.services.workspace_service import WorkspaceService


@pytest.fixture
def inventory_env(tmp_path, monkeypatch):
    root = tmp_path / "files"
    root.mkdir()
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "db", data_dir=tmp_path))
    reset_db()
    ws = WorkspaceService().create_workspace(WorkspaceCreate(name="Files", path=str(root)))
    try:
        yield root, ws, InventoryService()
    finally:
        reset_db()


def test_watch_updates_unsupported_files_and_folder_sizes(inventory_env):
    root, ws, inventory = inventory_env
    folder = root / "nested"
    folder.mkdir()
    target = folder / "movie.mp4"
    target.write_bytes(b"123")
    inventory.scan(ws, lambda: False, lambda *_: None)
    target.write_bytes(b"1234567")
    inventory.update_path(ws, target)
    assert inventory.browse(ws.id)["bytes"] == 7
    assert inventory.browse(ws.id, str(root))["items"][0]["size_bytes"] == 7
    assert inventory.search("movie").results[0].filename == "movie.mp4"
    target.unlink()
    inventory.update_path(ws, target)
    assert inventory.browse(ws.id)["files"] == 0


def test_access_errors_keep_previous_inventory(inventory_env, monkeypatch):
    root, ws, inventory = inventory_env
    (root / "one.bin").write_bytes(b"1")
    inventory.scan(ws, lambda: False, lambda *_: None)

    def deny(_):
        raise PermissionError("Access denied")

    monkeypatch.setattr(os, "scandir", deny)
    _, errors = inventory.scan(ws, lambda: False, lambda *_: None)
    assert errors
    result = inventory.browse(ws.id)
    assert result["files"] == 1
    assert result["scan_status"] == "completed_with_errors"


def test_scan_does_not_follow_junction_loop(inventory_env):
    root, ws, inventory = inventory_env
    (root / "one.bin").write_bytes(b"1")
    loop = root / "loop"
    if os.name == "nt":
        import subprocess

        subprocess.run(["cmd", "/c", "mklink", "/J", str(loop), str(root)], check=True, capture_output=True)
    else:
        loop.symlink_to(root, target_is_directory=True)
    try:
        count, errors = inventory.scan(ws, lambda: False, lambda *_: None)
        assert count == 1 and not errors
        assert inventory.browse(ws.id)["total"] == 2
    finally:
        loop.unlink() if os.name != "nt" else loop.rmdir()


def test_ai_without_selection_never_calls_provider(monkeypatch):
    from app.services.ai import context_engine

    monkeypatch.setattr(context_engine, "get_llm_provider", lambda *_: pytest.fail("Provider must not be called"))
    result = AIContextEngine().query(AIQueryRequest(question="Summarize my files"))
    assert result.evidence_count == 0 and result.provider_used == "none"


def test_credentials_are_visible_only_as_metadata(inventory_env):
    root, ws, inventory = inventory_env
    target = root / "application_default_credentials.json"
    target.write_text('{"refresh_token":"private"}')
    inventory.scan(ws, lambda: False, lambda *_: None)
    assert inventory.browse(ws.id)["files"] == 1
    from app.services.ai.tools import AIToolManager
    from app.services.indexer_service import IndexerService

    assert not IndexerService().index_single_file(target, ws.id)
    assert "error" in AIToolManager().execute_tool("read_file", {"path": str(target)})


def test_watcher_updates_metadata_without_indexing_unsupported_content(inventory_env, monkeypatch):
    root, ws, inventory = inventory_env
    from watchfiles import Change

    from app.services.watcher_service import WatcherService

    watcher = WatcherService()
    target = root / "recording.mp4"
    target.write_bytes(b"video")
    monkeypatch.setattr(watcher.indexer_service, "index_single_file", lambda *_: False)
    watcher._handle_changes({(Change.added, str(target))})
    assert inventory.browse(ws.id)["files"] == 1
    assert watcher.activity_service.list_activities()[0].activity_type.value == "file_created"
    database = config.get_settings().get_database_path()
    watcher._handle_changes({(Change.modified, str(database))})
    assert inventory.browse(ws.id)["files"] == 1
    assert len(watcher.activity_service.list_activities()) == 1


def test_partial_scan_preserves_cached_descendant_rollups(inventory_env, monkeypatch):
    root, ws, inventory = inventory_env
    folder = root / "restricted"
    folder.mkdir()
    (folder / "retained.bin").write_bytes(b"retained")
    inventory.scan(ws)
    original = os.scandir
    def deny_nested(path):
        if str(path) == str(folder):
            raise PermissionError("Access denied")
        return original(path)
    monkeypatch.setattr(os, "scandir", deny_nested)
    inventory.scan(ws)
    result = inventory.browse(ws.id, str(root))
    item = next(row for row in result["items"] if row["name"] == "restricted")
    assert item["size_bytes"] == 8 and item["file_count"] == 1
    assert result["bytes"] == 8 and result["scan_status"] == "completed_with_errors"


def test_selected_storage_reports_allocation_and_shared_hard_links(inventory_env):
    from app.services.storage_metadata import file_storage
    root, ws, inventory = inventory_env
    source = root / "allocation.bin"
    source.write_bytes(b"x" * 8193)
    alias = root / "alias.bin"
    os.link(source, alias)
    first, second = file_storage(source), file_storage(alias)
    assert first["logical_bytes"] == 8193
    assert first["allocated_bytes"] is not None
    assert first["allocated_bytes"] == second["allocated_bytes"]
    assert first["hard_links"] == second["hard_links"] == 2


@pytest.mark.skipif(os.name != "nt", reason="NTFS sparse allocation")
def test_sparse_storage_keeps_64_bit_logical_size(inventory_env):
    import subprocess
    from app.services.storage_metadata import file_storage
    root, _, _ = inventory_env
    source = root / "sparse.bin"
    source.touch()
    subprocess.run(["fsutil", "sparse", "setflag", str(source)], check=True, capture_output=True)
    import ctypes
    import msvcrt
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.SetFilePointerEx.argtypes = [wintypes.HANDLE, ctypes.c_longlong, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetEndOfFile.argtypes = [wintypes.HANDLE]
    with source.open("r+b") as handle:
        native = msvcrt.get_osfhandle(handle.fileno())
        assert kernel.SetFilePointerEx(native, 5 * 1024 ** 3, None, 0)
        assert kernel.SetEndOfFile(native)
    details = file_storage(source)
    assert details["logical_bytes"] == 5 * 1024 ** 3
    assert details["allocated_bytes"] < 1024 ** 2


def test_storage_route_validates_scope_and_missing_file(inventory_env, tmp_path):
    from fastapi.testclient import TestClient
    from app.local_main import app
    root, _, _ = inventory_env
    source = root / "example.bin"
    source.write_bytes(b"data")
    with TestClient(app) as client:
        assert client.get("/api/system/file-storage", params={"path": str(source)}).json()["logical_bytes"] == 4
        assert client.get("/api/system/file-storage", params={"path": str(root / "missing.bin")}).status_code == 404
        assert client.get("/api/system/file-storage", params={"path": str(tmp_path / "outside.bin")}).status_code == 403
