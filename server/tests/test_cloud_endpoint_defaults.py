"""Installed builds use hosted accounts; developer builds stay local."""
import sys
import json

from app.core.config import Settings


def test_installed_default_uses_bundled_build_configuration(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    (tmp_path / "desktop-config.json").write_text(json.dumps({"api_base_url": "https://build.example.com"}))
    monkeypatch.delenv("CLOUD_SYNC_URL", raising=False)
    settings = Settings(_env_file=None)
    assert settings.cloud_sync_url == "https://build.example.com"
    assert settings.cloud_sync_enabled is False
    assert settings.cloud_sync_token is None


def test_development_default_stays_local(monkeypatch):
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.delenv("CLOUD_SYNC_URL", raising=False)
    assert Settings(_env_file=None).cloud_sync_url == "http://localhost:8080"


def test_explicit_endpoint_is_preserved(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setenv("CLOUD_SYNC_URL", "https://custom.example.com")
    assert Settings(_env_file=None).cloud_sync_url == "https://custom.example.com"
