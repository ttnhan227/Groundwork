import tempfile
from pathlib import Path

import pytest

from app.core import config
from app.models.types import WorkspaceCreate
from app.services.duplicate_service import DuplicateService
from app.services.indexer_service import IndexerService
from app.services.inventory_service import InventoryService
from app.services.workspace_service import WorkspaceService


def test_exact_duplicate_detection_and_similar_names(tmp_path):
    folder = tmp_path / "data"
    folder.mkdir()
    db_path = tmp_path / "test.db"
    config._settings = config.Settings(database_path=db_path, data_dir=tmp_path)

    # Create files: 2 exact duplicates, 1 unique with same size but different content, 1 similar name with different content
    f1 = folder / "doc.txt"
    f1.write_text("identical text 12345", encoding="utf-8")

    f2 = folder / "doc - Copy.txt"
    f2.write_text("identical text 12345", encoding="utf-8")

    # Same size, different content
    f3 = folder / "diff.txt"
    f3.write_text("different text 54321", encoding="utf-8")

    # Similar name, different size
    f4 = folder / "doc (1).txt"
    f4.write_text("different content altogether", encoding="utf-8")

    ws = WorkspaceService().create_workspace(WorkspaceCreate(name="Test", path=str(folder)))
    inv = InventoryService()
    inv.scan(ws, lambda: False, lambda count, current, err: None)

    dup_svc = DuplicateService()
    result = dup_svc.find_duplicates(ws.id)

    # Exact duplicates should have exactly 1 group of 2 files
    assert result["total_exact_groups"] == 1
    group = result["exact_duplicates"][0]
    paths = {f["path"] for f in group["files"]}
    assert str(f1) in paths
    assert str(f2) in paths
    assert str(f3) not in paths
    assert group["potential_waste_bytes"] == f1.stat().st_size

    # Source files must not be deleted or modified
    assert f1.exists()
    assert f2.exists()
    assert f3.exists()
    assert f4.exists()

    # Similar names should detect doc / doc - Copy / doc (1)
    similar_stems = [s["base_name"] for s in result["similar_names"]]
    assert "doc" in similar_stems

    from app.database.local_db import reset_db
    reset_db()
