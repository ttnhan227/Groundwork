"""End-user sign-in uses the configured service without a URL field."""
import base64
import json
from types import SimpleNamespace

from app.routers.api import CloudLoginRequest, GoogleStartRequest, google_start
from app.services import google_signin_service, preferences_service


def test_google_start_uses_configured_service_without_user_url(monkeypatch):
    configured = SimpleNamespace(cloud_sync_url="https://accounts.example.com")
    called = []
    monkeypatch.setattr("app.routers.api.get_settings", lambda: configured)
    monkeypatch.setattr(google_signin_service, "start_google", lambda url, link: called.append((url, link)) or {"session_id": "session"})
    assert google_start(GoogleStartRequest()) == {"session_id": "session"}
    assert called == [(configured.cloud_sync_url, False)]
    assert CloudLoginRequest(email="person@example.com", password="long-enough-password").url is None


def test_retired_gemini_default_is_updated_without_changing_custom_model(tmp_path, monkeypatch):
    configured = SimpleNamespace(get_database_path=lambda: tmp_path / "groundwork.db", gemini_model="gemini-3.8-flash")
    monkeypatch.setattr(preferences_service, "get_settings", lambda: configured)
    monkeypatch.setattr(preferences_service, "_protect", lambda data, decrypt=False: data)
    service = preferences_service.PreferencesService()
    for saved, expected in [("gemini-1.5-flash", "gemini-3.8-flash"), ("my-custom-model", "my-custom-model")]:
        service.path.write_bytes(base64.b64encode(json.dumps({"gemini_model": saved}).encode()))
        service.load()
        assert configured.gemini_model == expected
