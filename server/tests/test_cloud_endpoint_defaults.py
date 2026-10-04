"""Installed builds use hosted accounts; developer builds stay local."""
import sys

from app.core.config import Settings


def test_installed_default_uses_verified_hosted_root(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delenv("CLOUD_SYNC_URL", raising=False)
    settings = Settings(_env_file=None)
    assert settings.cloud_sync_url == "https://groundwork-api-597984371188.asia-southeast1.run.app"
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
