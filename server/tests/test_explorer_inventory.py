import time

from app.core import config
from app.database.local_db import reset_db
from app.models.types import WorkspaceCreate
from app.services.inventory_service import InventoryService
from app.services.workspace_service import WorkspaceService


def test_recursive_scope_wildcards_folder_tree_and_global_pagination(tmp_path, monkeypatch):
    root = tmp_path / "root"
    for directory in [root / "Project" / "src", root / "ProjectOther", tmp_path / "second"]:
        directory.mkdir(parents=True)
    (root / "Project" / "src" / "main.TS").write_bytes(b"x" * 20)
    (root / "Project" / "README.md").write_bytes(b"x" * 10)
    (root / "ProjectOther" / "main.ts").write_bytes(b"x" * 40)
    (root / "movie.mp4").write_bytes(b"x" * 100)
    (tmp_path / "second" / "report.txt").write_bytes(b"x" * 30)
    monkeypatch.setattr(config, "_settings", config.Settings(database_path=tmp_path / "db", data_dir=tmp_path))
    reset_db()
    try:
        workspaces = WorkspaceService()
        first = workspaces.create_workspace(WorkspaceCreate(name="First", path=str(root)))
        second = workspaces.create_workspace(WorkspaceCreate(name="Second", path=str(tmp_path / "second")))
        service = InventoryService()
        service.scan(first)
        service.scan(second)
        branch = service.browse(first.id, str(root), kind="folder", limit=1)
        assert branch["total"] == 2 and len(branch["items"]) == 1
        alias = service.browse(first.id, str(root / "Project" / ".."), kind="folder")
        assert alias["total"] == 2 and len(alias["items"]) == 2
        assert alias["parent_bytes"] == 170
        result = service.browse(first.id, str(root / "Project"), recursive=True, kind="file", query="*.ts")
        assert result["total"] == 1 and result["items"][0]["name"] == "main.TS"
        assert result["parent_bytes"] == 30
        assert service.browse(first.id, str(root / "Project"), recursive=True, category="code")["total"] == 2
        assert service.browse(first.id, str(root / "Project"), recursive=True, min_size=15, kind="file")["total"] == 1
        assert service.browse(first.id, modified_after=time.time() + 60)["total"] == 0
        all_files = service.browse(None, kind="file", sort="size", descending=True, limit=2, offset=2)
        assert all_files["total"] == 5
        assert [item["size_bytes"] for item in all_files["items"]] == [30, 20]
        assert [item["parent_size_bytes"] for item in all_files["items"]] == [30, 20]
        assert all_files["files"] == 5 and all_files["bytes"] == 200
        assert all_files["category_breakdown"][0]["size_bytes"] == 100
        statements = []
        conn = service.db.get_connection()
        conn.set_trace_callback(statements.append)
        service.browse(None, kind="file", category="code")
        conn.set_trace_callback(None)
        assert not any("GROUP BY" in statement.upper() for statement in statements)
        conn.execute("UPDATE workspaces SET is_active=0 WHERE id=?", (second.id,))
        conn.commit()
        assert service.browse(None, kind="file")["total"] == 4
        assert service.browse(None, kind="file")["bytes"] == 170
    finally:
        reset_db()
