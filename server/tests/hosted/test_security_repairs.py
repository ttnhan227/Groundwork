import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.hosted.core.security import hash_password, verify_password
from app.hosted.main import app
from app.hosted.routers.sync import SyncPushRequest


def test_passwords_have_unique_salts_and_verify():
    first = hash_password("A long test password")
    second = hash_password("A long test password")
    assert first != second
    assert verify_password("A long test password", first)
    assert not verify_password("wrong", first)


def test_registration_rejects_invalid_credentials():
    client = TestClient(app)
    response = client.post("/auth/register", json={"email": "not-an-email", "password": ""})
    assert response.status_code == 422


def test_sync_rejects_unknown_entities_and_actions():
    for entity, action in [("source_code", "upsert"), ("note", "execute")]:
        with pytest.raises(ValidationError):
            SyncPushRequest(items=[{"queue_id": "q", "entity_id": "n", "entity_type": entity, "action": action}])
