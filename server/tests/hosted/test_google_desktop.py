"""Google browser handoff security, linking, expiry and single redemption."""
import time
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.hosted.core.config import get_cloud_settings
from app.hosted.core.database import Base, get_db
from app.hosted.main import app
from app.hosted.models.entities import GoogleDesktopSession
from app.hosted.routers import auth


@pytest.fixture
def handoff(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'handoff.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    def database():
        with sessions() as db:
            yield db
    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(get_cloud_settings(), "google_client_id", "test-client")
    claims = {"sub": "google-subject", "email": "handoff@example.com", "email_verified": True}
    monkeypatch.setattr(auth.id_token, "verify_oauth2_token", lambda *args: claims)
    yield TestClient(app), sessions, claims
    app.dependency_overrides.clear()
    engine.dispose()


def begin(client, sessions, claims, **kwargs):
    response = client.post("/auth/google/desktop/start", json={"link": bool(kwargs)}, **kwargs)
    assert response.status_code == 200, response.text
    data = response.json()
    browser = parse_qs(urlsplit(data["browser_path"]).query)
    with sessions() as db:
        session = db.get(GoogleDesktopSession, data["session_id"])
        claims["nonce"] = session.nonce
        assert session.poll_hash != data["secret"]
        assert session.browser_hash != browser["secret"][0]
    return data, {"session_id": data["session_id"], "secret": browser["secret"][0], "id_token": "verified-credential"}


def test_handoff_pending_nonce_bound_and_single_use(handoff):
    client, sessions, claims = handoff
    data, complete = begin(client, sessions, claims)
    poll = {"session_id": data["session_id"], "secret": data["secret"]}
    assert client.post("/auth/google/desktop/poll", json=poll).json() == {"status": "pending"}
    assert client.post("/auth/google/desktop/poll", json={**poll, "secret": complete["secret"]}).status_code == 404
    page = client.get(data["browser_path"])
    assert page.status_code == 200
    assert page.headers["cache-control"] == "no-store"
    assert page.headers["referrer-policy"] == "no-referrer"
    assert data["secret"] not in page.text
    nonce = claims["nonce"]
    claims["nonce"] = "wrong"
    assert client.post("/auth/google/desktop/complete", json=complete).status_code == 401
    claims["nonce"] = nonce
    assert client.post("/auth/google/desktop/complete", json=complete).status_code == 200
    assert client.post("/auth/google/desktop/complete", json=complete).status_code == 409
    account = client.post("/auth/google/desktop/poll", json=poll)
    assert account.status_code == 200
    assert account.json()["status"] == "authenticated"
    assert client.get("/auth/me", headers={"Authorization": "Bearer " + account.json()["access_token"]}).status_code == 200
    assert client.post("/auth/google/desktop/poll", json=poll).status_code == 410


def test_expired_session_and_link_require_existing_login(handoff):
    client, sessions, claims = handoff
    assert client.post("/auth/google/desktop/start", json={"link": True}).status_code == 401
    data, complete = begin(client, sessions, claims)
    with sessions() as db:
        db.get(GoogleDesktopSession, data["session_id"]).expires_at = int(time.time()) - 1
        db.commit()
    assert client.post("/auth/google/desktop/complete", json=complete).status_code == 410
    account = client.post("/auth/register", json={"email": claims["email"], "password": "long-handoff-test-password"}).json()
    data, complete = begin(client, sessions, claims, headers={"Authorization": "Bearer " + account["access_token"]})
    assert client.post("/auth/google/desktop/complete", json=complete).status_code == 200
    result = client.post("/auth/google/desktop/poll", json={"session_id": data["session_id"], "secret": data["secret"]})
    assert result.json()["user_id"] == account["user_id"]
