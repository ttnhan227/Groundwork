from app.core import config
from app.database.local_db import reset_db
from app.models.types import WorkspaceCreate
from app.services.indexer_service import IndexerService
from app.services.workspace_service import WorkspaceService


def test_counts_are_available_before_project_inspection(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "test.db", data_dir=tmp_path))
    (tmp_path / "one.py").write_text("answer = 42")
    (tmp_path / "two.py").write_text("answer = 43")
    reset_db()
    try:
        workspace = WorkspaceService().create_workspace(WorkspaceCreate(name="Example", path=str(tmp_path)))
        indexer = IndexerService()
        observed = []

        def projects(*_):
            progress = indexer.get_progress()
            observed.append((progress.phase, progress.files_discovered))
            return []

        monkeypatch.setattr(indexer.project_service, "discover_projects_in_workspace", projects)

        def index_file(*_):
            assert indexer.get_progress().phase == "indexing"
            return True

        monkeypatch.setattr(indexer, "index_single_file", index_file)
        result = indexer.index_workspace_sync(workspace.id)
        assert observed == [("projects", 2)]
        assert result.files_indexed == result.files_discovered == 2
        assert result.percent == 100
        assert result.status.value == "completed"
    finally:
        reset_db()


def test_discovery_reports_live_counts_and_stops_on_cancel(tmp_path, monkeypatch):
    indexer = IndexerService()
    for i in range(4):
        (tmp_path / f"{i}.py").write_text("x = 1")
    monkeypatch.setattr(indexer, "_is_ignored", lambda *_: False)
    counts = []

    def supported(_):
        counts.append(indexer.get_progress().files_discovered)
        if len(counts) == 2:
            indexer._cancel_requested.set()
        return True

    monkeypatch.setattr(indexer.parser, "is_supported", supported)
    found = indexer._discover_files(tmp_path, [])
    assert counts == [0, 1]
    assert len(found) == indexer.get_progress().files_discovered == 2


def test_all_inventories_are_available_before_content_processing(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "db", data_dir=tmp_path))
    reset_db()
    try:
        roots = [tmp_path / "first", tmp_path / "second"]
        workspaces = []
        for root in roots:
            root.mkdir()
            (root / "one.py").write_text("x=1")
            (root / "picture.png").write_bytes(b"unsupported")
            workspaces.append(WorkspaceService().create_workspace(WorkspaceCreate(name=root.name, path=str(root))))
        indexer = IndexerService()
        from app.services.inventory_service import InventoryService

        observed = []

        def projects(workspace_id, root):
            assert str(root) == next(ws.path for ws in workspaces if ws.id == workspace_id)
            observed.append([InventoryService().browse(ws.id)["files"] for ws in workspaces])
            return []

        monkeypatch.setattr(indexer.project_service, "discover_projects_in_workspace", projects)

        def content(*_):
            assert indexer.get_progress().files_discovered == 2
            return True

        monkeypatch.setattr(indexer, "index_single_file", content)
        result = indexer.index_workspace_sync()
        assert observed == [[2, 2], [2, 2]]
        assert result.files_inventoried == 4 and result.files_indexed == 2
    finally:
        reset_db()


import pytest


@pytest.mark.parametrize("explicit_resume", [True, False])
def test_resume_during_cancellation_is_queued_but_watcher_does_not_restart(monkeypatch, explicit_resume):
    import threading
    from app.models.types import IndexStatus
    indexer = IndexerService()
    entered, release = threading.Event(), threading.Event()
    calls = []
    def worker(*_):
        calls.append(1)
        if len(calls) == 1:
            entered.set()
            assert release.wait(5)
        with indexer._lock:
            indexer._progress.status = IndexStatus.CANCELLED if indexer._cancel_requested.is_set() else IndexStatus.COMPLETED
    monkeypatch.setattr(indexer, "_run_indexing_worker", worker)
    indexer.start_indexing()
    try:
        assert entered.wait(5)
        indexer.cancel_indexing()
        indexer.start_indexing(resume=explicit_resume)
    finally:
        release.set()
        indexer.wait_for_completion(5)
    assert len(calls) == (2 if explicit_resume else 1)
    assert indexer.get_progress().status == (IndexStatus.COMPLETED if explicit_resume else IndexStatus.CANCELLED)
    if not explicit_resume:
        indexer.start_indexing(resume=True)
        indexer.wait_for_completion(5)
        assert len(calls) == 2, "A stale watcher request must not cause a third run"


def test_concurrent_new_file_indexing_keeps_one_consistent_identity(tmp_path, monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from types import SimpleNamespace
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "db", data_dir=tmp_path))
    root = tmp_path / "files"
    root.mkdir()
    source = root / "shared.py"
    source.write_text("concurrent_identity_needle = 42", encoding="utf-8")
    reset_db()
    try:
        ws = WorkspaceService().create_workspace(WorkspaceCreate(name="Concurrent", path=str(root)))
        indexer = IndexerService()
        indexer._embeddings = SimpleNamespace(model_id="fixture", embed_text=lambda _: [1.0])
        parse = indexer.parser.parse_file
        together = threading.Barrier(2)
        def synchronize(*args, **kwargs):
            result = parse(*args, **kwargs)
            together.wait(timeout=5)
            return result
        monkeypatch.setattr(indexer.parser, "parse_file", synchronize)
        with ThreadPoolExecutor(max_workers=2) as executor:
            pending = [executor.submit(indexer.index_single_file, source, ws.id) for _ in range(2)]
            assert all(future.result() for future in pending)
        conn = indexer.db.get_connection()
        assert conn.execute("SELECT count(*) FROM files").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM chunks").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM fts_files").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM fts_chunks").fetchone()[0] == 1
        assert not conn.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        reset_db()


def test_slow_old_parse_cannot_overwrite_a_newer_watcher_update(tmp_path, monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from types import SimpleNamespace
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "db", data_dir=tmp_path))
    root = tmp_path / "files"
    root.mkdir()
    source = root / "changing.py"
    source.write_text("old_version_marker = 1", encoding="utf-8")
    reset_db()
    parsed, release = threading.Event(), threading.Event()
    try:
        ws = WorkspaceService().create_workspace(WorkspaceCreate(name="Changing", path=str(root)))
        old, fresh = IndexerService(), IndexerService()
        old._embeddings = fresh._embeddings = SimpleNamespace(model_id="fixture", embed_text=lambda _: [1.0])
        parse = old.parser.parse_file
        def delayed(*args, **kwargs):
            result = parse(*args, **kwargs)
            parsed.set()
            assert release.wait(5)
            return result
        monkeypatch.setattr(old.parser, "parse_file", delayed)
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(old.index_single_file, source, ws.id)
            try:
                assert parsed.wait(5)
                source.write_text("new_version_marker = 2", encoding="utf-8")
                assert fresh.index_single_file(source, ws.id)
            finally:
                release.set()
            assert pending.result() is False
        contents = fresh.db.get_connection().execute("SELECT content FROM fts_chunks").fetchall()
        assert len(contents) == 1 and "new_version_marker" in contents[0]["content"]
    finally:
        release.set()
        reset_db()
