"""Real metadata-scale, abrupt WAL recovery, ACL and change-batch validation."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

repo = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(repo / "server"))
from app.core import config
from app.database.local_db import reset_db
from app.models.types import WorkspaceCreate
from app.services.inventory_service import InventoryService
from app.services.workspace_service import WorkspaceService


def configure(root):
    config._settings = config.Settings(database_path=root / "state.db", data_dir=root)
    reset_db()


if len(sys.argv) > 1 and sys.argv[1] == "--crash":
    root = Path(sys.argv[2])
    configure(root)
    ws = WorkspaceService().list_workspaces()[0]
    def interrupt(count, *_):
        if count >= 2000:
            os._exit(77)
    InventoryService().scan(ws, report=interrupt)
    raise AssertionError("Crash point never reached")

with tempfile.TemporaryDirectory(prefix="groundwork-storage-stress-") as directory:
    root = Path(directory).resolve()
    files = root / "files"
    files.mkdir()
    count = int(os.environ.get("GROUNDWORK_STORAGE_COUNT", "25000"))
    expected_bytes = 0
    for index in range(count):
        folder = files / f"folder-{index // 250:04}"
        folder.mkdir(exist_ok=True)
        size = index % 128 + 1
        (folder / f"item-{index:06}.bin").write_bytes(b"x" * size)
        expected_bytes += size
    try:
        configure(root)
        ws = WorkspaceService().create_workspace(WorkspaceCreate(name="Storage stress", path=str(files)))
        reset_db()
        interrupted = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--crash", str(root)], cwd=root)
        assert interrupted.returncode == 77, interrupted.returncode
        configure(root)
        inventory = InventoryService()
        started = time.monotonic()
        found, errors = inventory.scan(ws)
        elapsed = time.monotonic() - started
        assert found == count and not errors
        result = inventory.browse(ws.id, str(files))
        assert result["files"] == count and result["bytes"] == expected_bytes
        assert sum(item["size_bytes"] for item in result["items"]) == expected_bytes
        # An actual Windows ACL denial must preserve known folder rollups.
        restricted = files / "folder-0000"
        before = next(item for item in result["items"] if item["name"] == restricted.name)["size_bytes"]
        subprocess.run(["icacls", str(restricted), "/deny", "*S-1-1-0:(RD)"], check=True, capture_output=True)
        try:
            _, errors = inventory.scan(ws)
            assert errors, "Expected real directory ACL denial"
            partial = inventory.browse(ws.id, str(files))
            assert partial["bytes"] == expected_bytes
            assert next(item for item in partial["items"] if item["name"] == restricted.name)["size_bytes"] == before
            assert partial["scan_status"] == "completed_with_errors"
        finally:
            subprocess.run(["icacls", str(restricted), "/remove:d", "*S-1-1-0"], check=True, capture_output=True)
        # Watcher batch: create, rename and delete unsupported-content files.
        from watchfiles import Change
        from app.services.watcher_service import WatcherService
        watcher = WatcherService()
        added = files / "rapid"
        added.mkdir()
        changes = set()
        for index in range(300):
            target = added / f"rapid-{index}.bin"
            target.write_bytes(b"1234")
            changes.add((Change.added, str(target)))
        watcher._handle_changes(changes)
        changes = set()
        for index in range(100):
            source = added / f"rapid-{index}.bin"
            target = added / f"renamed-{index}.bin"
            source.rename(target)
            changes.update({(Change.deleted, str(source)), (Change.added, str(target))})
        for index in range(100, 200):
            target = added / f"rapid-{index}.bin"
            target.unlink()
            changes.add((Change.deleted, str(target)))
        watcher._handle_changes(changes)
        inventory.scan(ws)
        result = inventory.browse(ws.id, str(files))
        assert result["files"] == count + 200 and result["bytes"] == expected_bytes + 800
        print(json.dumps({"real_files": count, "recovery_scan_seconds": round(elapsed, 3),
                          "abrupt_wal_recovery": True, "actual_acl_denial": True,
                          "watcher_mutations": 600, "final_files": result["files"],
                          "logical_bytes_verified": True}))
        reset_db()
    finally:
        reset_db()
