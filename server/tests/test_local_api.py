"""Integration tests for Groundwork Local FastAPI REST endpoints."""

import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.core import config
from app.main import app


def test_api_endpoints_integration():
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        db_path = root / "test_api.db"
        config._settings = config.Settings(database_path=db_path, data_dir=root)

        # Create a sample project in tmpdir
        sample_proj = root / "demo-project"
        sample_proj.mkdir()
        (sample_proj / "package.json").write_text('{"name": "demo-project", "dependencies": {"react": "^19.0.0"}}')
        (sample_proj / "README.md").write_text("# Demo Project\nA sample React application.")

        client = TestClient(app)

        # 1. Health check
        res = client.get("/health")
        assert res.status_code == 200
        assert res.json()["service"] == "groundwork-local"

        # 2. Add workspace
        res = client.post("/api/workspaces", json={"name": "DemoWS", "path": str(root)})
        assert res.status_code == 200
        ws_id = res.json()["id"]
        assert ws_id is not None

        # 3. List workspaces
        res = client.get("/api/workspaces")
        assert res.status_code == 200
        assert len(res.json()) >= 1

        # 4. List projects
        res = client.get("/api/projects")
        assert res.status_code == 200

        # 5. Search workspace
        res = client.get("/api/search", params={"q": "Demo Project"})
        assert res.status_code == 200
        assert "results" in res.json()

        # 6. Create note
        res = client.post("/api/notes", json={
            "title": "API Test Note",
            "content": "Testing notes API endpoint.",
            "tags": ["test"],
        })
        assert res.status_code == 200
        note_id = res.json()["id"]
        assert note_id is not None

        # 7. List notes
        res = client.get("/api/notes")
        assert res.status_code == 200
        assert len(res.json()) >= 1

        # 8. Create context session
        res = client.post("/api/context-sessions", json={
            "title": "API Session",
            "summary": "Testing session lifecycle",
            "files_inspected": ["README.md"],
        })
        assert res.status_code == 200
        assert res.json()["status"] == "active"

        # 9. Get system status
        res = client.get("/api/system/status")
        assert res.status_code == 200
        assert res.json()["status"] == "ready"

        from app.services.indexer_service import IndexerService
        IndexerService.get_instance().cancel_indexing()
        IndexerService.get_instance().wait_for_completion(timeout=2.0)

        from app.database.local_db import reset_db
        reset_db()
