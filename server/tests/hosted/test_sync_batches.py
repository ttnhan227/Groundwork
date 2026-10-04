"""Offline create/edit batches use the production session's autoflush behavior."""
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.hosted.core.database import Base, get_db
from app.hosted.main import app


def test_queued_create_edit_retry_and_stale_revision(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'batch.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False)
    def database():
        with sessions() as db:
            yield db
    app.dependency_overrides[get_db] = database
    try:
        client = TestClient(app)
        account = client.post('/auth/register', json={'email': 'batch@example.com', 'password': 'long-batch-test-password'}).json()
        headers = {'Authorization': 'Bearer ' + account['access_token']}
        items = [
            {'queue_id': 'create', 'entity_type': 'note', 'entity_id': 'offline-note', 'action': 'upsert', 'payload': {'title': 'Note', 'content': 'Initial', 'base_version': 0}},
            {'queue_id': 'edit', 'entity_type': 'note', 'entity_id': 'offline-note', 'action': 'upsert', 'payload': {'content': 'Edited offline', 'base_version': 1}},
        ]
        for _ in range(2):
            response = client.post('/sync/push', json={'items': items}, headers=headers)
            assert response.status_code == 200, response.text
            assert response.json()['acknowledged_queue_ids'] == ['create', 'edit']
            note = client.get('/sync/pull', headers=headers).json()['notes'][0]
            assert note['content'] == 'Edited offline'
            assert note['version'] == 2
        stale = {**items[1], 'queue_id': 'stale', 'payload': {'content': 'Stale edit', 'base_version': 0}}
        assert client.post('/sync/push', json={'items': [stale]}, headers=headers).status_code == 409
        assert client.get('/sync/pull', headers=headers).json()['notes'][0]['content'] == 'Edited offline'
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
