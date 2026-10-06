from app.core import config
from app.database.local_db import reset_db
from app.models.types import WorkspaceCreate
from app.services.inventory_service import InventoryService
from app.services.workspace_service import WorkspaceService


def test_category_cache_filters_parent_bytes_and_watcher(tmp_path, monkeypatch):
    root = tmp_path / "files"
    root.mkdir()
    nested = root / "nested"
    nested.mkdir()
    for name, count in [("movie.MP4", 50), ("pack.zip", 20), ("book.pdf", 10), ("script.py", 8), (".env", 2), ("app.exe", 10)]:
        (nested / name).write_bytes(b"x" * count)
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "db", data_dir=tmp_path))
    reset_db()
    try:
        ws = WorkspaceService().create_workspace(WorkspaceCreate(name="Files", path=str(root)))
        service = InventoryService()
        service.scan(ws, lambda: False, lambda *_: None)
        result = service.browse(ws.id, str(root))
        assert result["parent_bytes"] == 100
        assert [c["size_bytes"] for c in result["category_breakdown"]] == [50, 20, 10, 10, 10]
        assert sum(c["percentage"] for c in result["category_breakdown"]) == 100
        assert service.browse(ws.id, category="code")["total"] == 2
        assert service.browse(ws.id, category="media")["items"][0]["name"] == "movie.MP4"
        assert service.browse(ws.id, category="code", offset=1, limit=1)["items"][0]["name"] == "script.py"
        assert service.browse(ws.id, str(nested))["parent_bytes"] == 100
        # Simulate the pre-category schema, then reopen through the migration.
        conn = service.db.get_connection()
        conn.execute("DROP INDEX inventory_ws_category")
        conn.execute("ALTER TABLE inventory DROP COLUMN category")
        conn.execute("DELETE FROM inventory_categories")
        conn.commit()
        reset_db()
        service = InventoryService()
        assert service.browse(ws.id, category="code")["total"] == 2
        assert service.browse(ws.id)["category_breakdown"][0]["size_bytes"] == 50
        statements = []
        conn = service.db.get_connection()
        conn.set_trace_callback(statements.append)
        service.browse(ws.id, category="documents")
        conn.set_trace_callback(None)
        assert not any("GROUP BY" in sql.upper() for sql in statements)
        (nested / "book.pdf").write_bytes(b"x" * 30)
        service.update_path(ws, nested / "book.pdf")
        assert service.browse(ws.id)["category_breakdown"][2]["size_bytes"] == 30
        (nested / "book.pdf").unlink()
        service.update_path(ws, nested / "book.pdf")
        assert service.browse(ws.id)["category_breakdown"][2]["file_count"] == 0
        service.scan(ws, lambda: True, lambda *_: None)
        assert service.browse(ws.id)["scan_status"] == "cancelled"
        assert service.browse(ws.id)["bytes"] == 90
    finally:
        reset_db()
