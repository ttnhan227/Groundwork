"""Tests for Groundwork Cloud Sync: Auth, Devices, Sync Push/Pull, and Isolation."""

import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.hosted.core.database import Base, get_db
from app.hosted.main import app


def test_cloud_sync_full_flow():
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db_path = Path(tmpdir) / "cloud_test.db"
        test_engine = create_engine(f"sqlite:///{test_db_path}", connect_args={"check_same_thread": False})
        TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
        Base.metadata.create_all(bind=test_engine)

        def override_get_db():
            db = TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        client = TestClient(app)

        try:
            # 1. Health check
            res = client.get("/health")
            assert res.status_code == 200

            # 2. Register User 1
            reg_res = client.post("/auth/register", json={
                "email": "developer1@example.com",
                "password": "Password123!",
            })
            assert reg_res.status_code == 200
            token1 = reg_res.json()["access_token"]
            headers1 = {"Authorization": f"Bearer {token1}"}

            # 3. Register Device
            dev_res = client.post("/devices", json={"device_name": "Work Laptop", "os_name": "Windows"}, headers=headers1)
            assert dev_res.status_code == 200
            assert dev_res.json()["device_name"] == "Work Laptop"

            # 4. Push sync items (Note + Saved Search)
            push_payload = {
                "items": [
                    {
                        "queue_id": "q1",
                        "entity_type": "note",
                        "entity_id": "note-123",
                        "action": "upsert",
                        "payload": {
                            "title": "Windows watcher debounce",
                            "content": "Windows file watcher requires 500ms debounce.",
                            "tags": ["windows", "bug"],
                        },
                    },
                    {
                        "queue_id": "q2",
                        "entity_type": "saved_search",
                        "entity_id": "search-456",
                        "action": "upsert",
                        "payload": {
                            "title": "PostgreSQL queries",
                            "query": "PostgreSQL migration",
                        },
                    },
                ]
            }
            push_res = client.post("/sync/push", json=push_payload, headers=headers1)
            assert push_res.status_code == 200
            assert push_res.json()["processed_count"] == 2

            replay = client.post("/sync/push", headers=headers1, json=push_payload)
            assert replay.status_code == 200
            assert replay.json()["acknowledged_queue_ids"] == ["q1", "q2"]
            # 5. Pull sync state (Simulating a second device)
            pull_res = client.get("/sync/pull", headers=headers1)
            assert pull_res.status_code == 200
            data = pull_res.json()
            assert len(data["notes"]) == 1
            assert data["notes"][0]["version"] == 1
            assert data["notes"][0]["title"] == "Windows watcher debounce"
            assert len(data["saved_searches"]) == 1
            assert data["saved_searches"][0]["query"] == "PostgreSQL migration"

            # 6. Tenant isolation: Register User 2 and verify empty pull
            reg_res2 = client.post("/auth/register", json={
                "email": "developer2@example.com",
                "password": "Password456!",
            })
            assert reg_res2.status_code == 200
            headers2 = {"Authorization": f"Bearer {reg_res2.json()['access_token']}"}
            pull_res2 = client.get("/sync/pull", headers=headers2)
            assert pull_res2.status_code == 200
            assert len(pull_res2.json()["notes"]) == 0
            assert len(pull_res2.json()["saved_searches"]) == 0
            deletion = client.post("/sync/push", headers=headers1, json={"items": [{"queue_id": "q3", "entity_type": "note", "entity_id": "note-123", "action": "delete"}]})
            assert deletion.status_code == 200
            state = client.get("/sync/pull", headers=headers1).json()
            assert state["notes"] == []
            assert state["tombstones"][0]["entity_id"] == "note-123"
            assert client.get("/sync/pull", headers=headers2).json()["tombstones"] == []
        finally:
            app.dependency_overrides.clear()
            test_engine.dispose()
