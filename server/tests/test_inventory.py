from app.core import config
from app.database.local_db import reset_db
from app.models.types import WorkspaceCreate
from app.services.inventory_service import InventoryService
from app.services.workspace_service import WorkspaceService


def test_inventory_includes_unsupported_hidden_empty_and_folder_totals(tmp_path, monkeypatch):
    root = tmp_path / "files"
    root.mkdir()
    (root / "nested").mkdir()
    (root / "nested" / "photo.unknown").write_bytes(b"12345")
    (root / ".env").write_text("secret")
    (root / "empty.bin").touch()
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "db", data_dir=tmp_path))
    reset_db()
    try:
        ws = WorkspaceService().create_workspace(WorkspaceCreate(name="Files", path=str(root)))
        inventory = InventoryService()
        counts = []
        count, errors = inventory.scan(ws, lambda: False, lambda n, *_: counts.append(n))
        assert count == 3 and not errors
        result = inventory.browse(ws.id, str(root))
        assert result["files"] == 3 and result["bytes"] == 11
        folder = next(item for item in result["items"] if item["kind"] == "folder")
        assert folder["size_bytes"] == 5 and folder["file_count"] == 1
        assert inventory.browse(ws.id, query="photo")["total"] == 1
        assert inventory.browse(ws.id, extension=".bin")["total"] == 1
        (root / "empty.bin").unlink()
        inventory.scan(ws, lambda: True, lambda *_: None)
        assert inventory.browse(ws.id)["files"] == 3
        _, errors = inventory.scan(ws, lambda: False, lambda *_: None)
        assert not errors, errors
        assert inventory.browse(ws.id)["files"] == 2
        assert counts[-1] == 3
    finally:
        reset_db()
