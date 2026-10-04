"""Desktop handoff keeps token material private and supports cancellation."""
import pytest
from fastapi import HTTPException

from app.services import google_signin_service as google


def test_browser_handoff_persists_credentials_only_inside_engine(monkeypatch):
    google._sessions.clear()
    opened, saved = [], []
    def hosted(url, path, body, token=None):
        if path.endswith("/start"):
            return {"session_id": "session", "secret": "private-poll-secret", "browser_path": "/auth/google/desktop/page?session_id=session&secret=browser-secret"}
        assert body["secret"] == "private-poll-secret"
        return {"status": "authenticated", "access_token": "private-account-token"}
    monkeypatch.setattr(google, "hosted_request", hosted)
    monkeypatch.setattr(google.webbrowser, "open", lambda url: opened.append(url) or True)
    monkeypatch.setattr(google.PreferencesService, "update", lambda self, values: saved.append(values))
    result = google.start_google("https://accounts.example.com")
    assert result == {"session_id": "session", "status": "pending"}
    assert opened[0].startswith("https://accounts.example.com/auth/google/desktop/page?")
    assert google.poll_google("session") == {"status": "authenticated"}
    assert saved[0]["cloud_sync_token"] == "private-account-token"
    with pytest.raises(HTTPException):
        google.poll_google("session")


def test_untrusted_browser_redirect_and_cancellation(monkeypatch):
    google._sessions.clear()
    monkeypatch.setattr(google, "hosted_request", lambda *args: {"browser_path": "https://other.example.com/"})
    with pytest.raises(HTTPException) as error:
        google.start_google("https://accounts.example.com")
    assert error.value.status_code == 502
    google._sessions["cancelled"] = {"expires": 9999999999}
    assert google.cancel_google("cancelled") == {"status": "cancelled"}
    assert "cancelled" not in google._sessions
