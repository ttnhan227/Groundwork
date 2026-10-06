"""Installer configuration must be explicit and safe to ship publicly."""
import runpy
from pathlib import Path

import pytest

normalize = runpy.run_path(str(Path(__file__).resolve().parents[2] / "desktop/scripts/prepare-desktop-config.py"))["normalize_api_url"]
read_api_url = runpy.run_path(str(Path(__file__).resolve().parents[2] / "desktop/scripts/prepare-desktop-config.py"))["read_api_url"]


def test_local_build_reads_only_address_from_root_env(monkeypatch, tmp_path):
    monkeypatch.delenv("DESKTOP_API_BASE_URL", raising=False)
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    (tmp_path / ".env").write_text('DESKTOP_API_BASE_URL="https://local-build.example.com/api/v1/"\nJWT_SECRET=private\n')
    assert read_api_url(tmp_path) == "https://local-build.example.com"
    import os
    assert "JWT_SECRET" not in os.environ


def test_explicit_environment_overrides_file(monkeypatch, tmp_path):
    monkeypatch.setenv("DESKTOP_API_BASE_URL", "https://override.example.com")
    (tmp_path / ".env").write_text("DESKTOP_API_BASE_URL=https://file.example.com")
    assert read_api_url(tmp_path) == "https://override.example.com"


def test_ci_requires_variable_even_when_local_env_exists(monkeypatch, tmp_path):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("DESKTOP_API_BASE_URL", raising=False)
    (tmp_path / ".env").write_text("DESKTOP_API_BASE_URL=https://file.example.com")
    with pytest.raises(ValueError, match="DESKTOP_API_BASE_URL"):
        read_api_url(tmp_path)


def test_normalizes_root_and_api_prefix(monkeypatch):
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    monkeypatch.delenv("GROUNDWORK_RELEASE_BUILD", raising=False)
    assert normalize(" https://accounts.example.com/api/v1/ ") == "https://accounts.example.com"
    assert normalize("http://localhost:8080/") == "http://localhost:8080"


@pytest.mark.parametrize("flag,value", [("GITHUB_ACTIONS", "true"), ("GROUNDWORK_RELEASE_BUILD", "1")])
def test_release_build_cannot_ship_a_localhost_backend(monkeypatch, flag, value):
    monkeypatch.setenv(flag, value)
    with pytest.raises(ValueError, match="Release builds"):
        normalize("http://localhost:8080")
    with pytest.raises(ValueError, match="Release builds"):
        normalize("https://localhost")
    assert normalize("https://accounts.example.com") == "https://accounts.example.com"


@pytest.mark.parametrize("value", ["", "http://accounts.example.com", "https://user:password@accounts.example.com", "https://accounts.example.com?key=secret", "https://accounts.example.com#fragment", "not-a-url"])
def test_rejects_missing_or_unsafe_build_configuration(value):
    with pytest.raises(ValueError):
        normalize(value)
