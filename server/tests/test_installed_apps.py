import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routers.api import system_router
from app.services import installed_apps


def test_windows_catalogue_handles_missing_metadata_and_caches(monkeypatch):
    import json
    from types import SimpleNamespace
    monkeypatch.setattr(installed_apps.sys, "platform", "win32")
    monkeypatch.setenv("WINDIR", "C:\\Windows")
    monkeypatch.setattr(installed_apps, "_cached", None)
    monkeypatch.setattr(installed_apps, "_updated", 0)
    calls = []
    values = [{"id": "a", "name": "Example", "publisher": None, "version": None},
              {"id": "b", "name": "Store app", "publisher": "CN=Microsoft Corporation, O=Microsoft Corporation, C=US"}]
    def run(*args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout=json.dumps(values).encode())
    monkeypatch.setattr(installed_apps.subprocess, "run", run)
    first = installed_apps.list_apps()
    assert first["apps"][0]["publisher"] == ""
    assert first["apps"][1]["publisher"] == "Microsoft Corporation"
    assert installed_apps.list_apps() == first
    assert len(calls) == 1
    installed_apps.list_apps(refresh=True)
    assert len(calls) == 2


def test_launch_only_accepts_catalogue_items(monkeypatch):
    app_id = "Example.Package!App"
    monkeypatch.setattr(installed_apps, "list_apps", lambda: {"apps": [{"id": app_id}]})
    opened = []
    monkeypatch.setattr(installed_apps.os, "startfile", opened.append, raising=False)
    assert installed_apps.launch_app(app_id) == {"success": True}
    assert opened == ["shell:AppsFolder\\" + app_id]
    for value in ["cmd.exe", "shell:AppsFolder", "https://example.com", "Example.Package!Other"]:
        with pytest.raises(ValueError):
            installed_apps.launch_app(value)
    assert len(opened) == 1


def test_catalogue_api_refresh_and_failed_launch(monkeypatch):
    app = FastAPI()
    app.include_router(system_router)
    refreshes = []
    monkeypatch.setattr(installed_apps, "list_apps", lambda refresh=False: refreshes.append(refresh) or {"apps": [], "supported": True})
    def unavailable(_):
        raise ValueError("Refresh the app list")
    monkeypatch.setattr(installed_apps, "launch_app", unavailable)
    with TestClient(app) as client:
        assert client.get("/api/system/installed-apps").status_code == 200
        assert client.get("/api/system/installed-apps?refresh=true").status_code == 200
        assert refreshes == [False, True]
        assert client.post("/api/system/installed-apps/launch", json={"path": "unknown"}).status_code == 422
