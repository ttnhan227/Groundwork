import os
import sqlite3
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from watchfiles import Change

from app.core import config
from app.database.local_db import LocalDatabase, reset_db
from app.models.types import WorkspaceCreate
from app.routers.api import system_router
from app.services.duplicate_service import DuplicateService
from app.services.indexer_service import IndexerService
from app.services.inventory_service import InventoryService
from app.services.organization_service import OrganizationService
from app.services.watcher_service import WatcherService
from app.services.workspace_service import WorkspaceService


@pytest.fixture
def inventory_fixture(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "audit.db", data_dir=tmp_path))
    reset_db()
    folder = tmp_path / "files"
    nested = folder / "nested"
    nested.mkdir(parents=True)
    item = nested / "single.txt"
    item.write_bytes(b"x" * 10)
    workspaces = WorkspaceService()
    first = workspaces.create_workspace(WorkspaceCreate(name="Parent", path=str(folder)))
    second = workspaces.create_workspace(WorkspaceCreate(name="Nested", path=str(nested)))
    inventory = InventoryService()
    inventory.scan(first)
    inventory.scan(second)
    yield inventory, workspaces, first, second, item
    reset_db()


def test_directory_events_preserve_rollups_and_advance_revision(inventory_fixture):
    inventory, _, first, _, item = inventory_fixture
    before = inventory.browse(first.id, first.path)
    inventory.update_path(first, item.parent)
    after = inventory.browse(first.id, first.path)
    assert after["items"][0]["size_bytes"] == 10
    assert after["items"][0]["file_count"] == 1
    assert after["updated_at"] > before["updated_at"]


def test_overlapping_roots_have_unique_global_totals_and_no_self_duplicates(inventory_fixture):
    inventory, _, first, second, item = inventory_fixture
    result = inventory.browse(None, kind="file")
    assert result["total"] == result["files"] == 1
    assert result["bytes"] == 10
    assert sum(c["file_count"] for c in result["category_breakdown"]) == 1
    assert DuplicateService().find_duplicates()["total_exact_groups"] == 0
    twin = item.parent / "copy.txt"
    twin.write_bytes(item.read_bytes())
    inventory.update_path(first, twin)
    inventory.update_path(second, twin)
    duplicates = DuplicateService().find_duplicates()
    assert duplicates["total_duplicate_files"] == 2
    assert duplicates["total_potential_waste_bytes"] == 10


def test_duplicate_bytes_count_hard_link_storage_once(inventory_fixture):
    inventory, _, first, _, item = inventory_fixture
    alias = item.parent / "linked.txt"
    os.link(item, alias)
    inventory.update_path(first, alias)
    duplicates = DuplicateService().find_duplicates(first.id)
    assert duplicates["total_potential_waste_bytes"] == 0
    assert duplicates["exact_duplicates"][0]["hard_link_aliases"] == 1
    copy = item.parent / "independent.txt"
    copy.write_bytes(item.read_bytes())
    inventory.update_path(first, copy)
    assert DuplicateService().find_duplicates(first.id)["total_potential_waste_bytes"] == 10


def test_watcher_converges_all_active_memberships(inventory_fixture):
    inventory, workspaces, first, second, item = inventory_fixture
    watcher = WatcherService.__new__(WatcherService)
    watcher.settings = config._settings
    watcher.workspace_service = workspaces
    watcher.project_service = SimpleNamespace(list_projects=lambda: [])
    indexed = []
    watcher.indexer_service = SimpleNamespace(index_single_file=lambda *args: indexed.append(args))
    watcher.activity_service = SimpleNamespace(record_activity=lambda **kwargs: None)
    item.write_bytes(b"x" * 30)
    watcher._handle_changes({(Change.modified, str(item))})
    assert inventory.browse(first.id)["bytes"] == inventory.browse(second.id)["bytes"] == 30
    assert len(indexed) == 1


def test_media_route_validates_scope_and_returns_metadata(inventory_fixture, tmp_path):
    _, _, _, _, item = inventory_fixture
    app = FastAPI()
    app.include_router(system_router)
    with TestClient(app) as client:
        assert client.get("/api/system/media-metadata", params={"path": str(item)}).status_code == 200
        assert client.get("/api/system/media-metadata", params={"path": str(tmp_path / "outside.wav")}).status_code == 403
        assert client.get("/api/system/media-metadata", params={"path": str(item.parent / "missing.wav")}).status_code == 404


def test_deleted_directory_removes_child_content_without_removing_sibling(inventory_fixture):
    inventory, _, first, _, item = inventory_fixture
    indexer = IndexerService()
    sibling = item.parent.parent / "nested-other" / "keep.txt"
    sibling.parent.mkdir()
    sibling.write_text("keep this searchable")
    assert indexer.index_single_file(item, first.id, [])
    assert indexer.index_single_file(sibling, first.id, [])
    indexer.remove_file(str(item.parent))
    conn = inventory.db.get_connection()
    paths = [row["path"] for row in conn.execute("SELECT path FROM files")]
    assert str(item) not in paths and str(sibling) in paths
    assert conn.execute("SELECT count(*) FROM fts_files").fetchone()[0] == 1
    assert conn.execute("SELECT count(*) FROM fts_chunks").fetchone()[0] == 1


def test_schema_upgrade_backs_up_committed_wal_and_rejects_newer_data(tmp_path):
    path = tmp_path / "upgrade.db"
    database = LocalDatabase(path)
    conn = database.get_connection()
    with conn:
        conn.execute("CREATE TABLE upgrade_evidence (content TEXT)")
        conn.execute("INSERT INTO upgrade_evidence VALUES ('preserved')")
        conn.execute("PRAGMA user_version = 0")
    # Keep the original connection alive to exercise backup with committed WAL.
    upgraded = LocalDatabase(path)
    with sqlite3.connect(str(path) + ".schema-v0.bak") as backup:
        assert backup.execute("SELECT content FROM upgrade_evidence").fetchone()[0] == "preserved"
        assert backup.execute("PRAGMA user_version").fetchone()[0] == 0
    assert upgraded.get_connection().execute("PRAGMA user_version").fetchone()[0] == 1
    with upgraded.get_connection() as connection:
        connection.execute("PRAGMA user_version = 2")
    upgraded.close()
    database.close()
    with pytest.raises(RuntimeError, match="newer Groundwork"):
        LocalDatabase(path)


@pytest.mark.skipif(os.name != "nt", reason="NTFS stream preservation uses Windows APIs")
def test_ntfs_streams_survive_move_and_undo_and_changed_stream_blocks_move(tmp_path):
    folder = tmp_path / "files"
    folder.mkdir()
    source = folder / "original.txt"
    source.write_text("primary content")
    from app.services.windows_files import security_descriptor
    before_security = security_descriptor(source).raw
    before_creation = source.stat().st_birthtime_ns
    stream = str(source) + ":Zone.Identifier"
    with open(stream, "w") as output:
        output.write("[ZoneTransfer]\nZoneId=3\n")
    service = OrganizationService(tmp_path / "journal", [folder])
    plan = service.preview([{"source": str(source), "relative": "moved.txt"}], str(folder))
    assert service.execute(plan["id"], True)["status"] == "completed"
    assert security_descriptor(folder / "moved.txt").raw == before_security
    assert (folder / "moved.txt").stat().st_birthtime_ns == before_creation
    with open(str(folder / "moved.txt") + ":Zone.Identifier") as input_file:
        assert "ZoneId=3" in input_file.read()
    assert service.execute(plan["id"], True, undo=True)["status"] == "undone"
    with open(stream) as input_file:
        assert "ZoneId=3" in input_file.read()
    plan = service.preview([{"source": str(source), "relative": "another.txt"}], str(folder))
    with open(stream, "w") as output:
        output.write("changed metadata")
    assert service.execute(plan["id"], True)["status"] == "needs-review"
    assert source.exists() and not (folder / "another.txt").exists()
