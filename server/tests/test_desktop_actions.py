import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.api import system_router
from app.services import desktop_actions


def test_screenshot_requires_bound_single_use_confirmation(monkeypatch):
    app = FastAPI()
    app.include_router(system_router)
    calls = []
    monkeypatch.setattr(
        desktop_actions, "perform", lambda action, value: calls.append((action, value)) or {"success": True}
    )
    with TestClient(app) as client:
        initial = client.post("/api/system/desktop-action", json={"action": "screenshot"}).json()
        assert initial["confirmation_required"] and not calls
        token = initial["confirmation_token"]
        response = client.post("/api/system/desktop-action", json={"action": "screenshot", "confirmation_token": token})
        assert response.status_code == 200 and calls == [("screenshot", "")]
        assert (
            client.post(
                "/api/system/desktop-action", json={"action": "screenshot", "confirmation_token": token}
            ).status_code
            == 403
        )
        assert (
            client.post("/api/system/desktop-action", json={"action": "app", "value": "powershell"}).status_code == 422
        )


@pytest.mark.parametrize(
    "url",
    ["file:///C:/secret", "javascript:alert(1)", "https://user:password@example.com", "shell:AppsFolder", "https://"],
)
def test_website_rejects_nonweb_schemes_and_credentials(url):
    with pytest.raises(ValueError):
        desktop_actions.perform("website", url)


def test_screenshot_is_saved_locally_without_network(tmp_path, monkeypatch):
    from PIL import Image, ImageGrab

    from app.core import config

    monkeypatch.setattr(config, "_settings", config.Settings(data_dir=tmp_path))
    monkeypatch.setattr(ImageGrab, "grab", lambda **_: Image.new("RGB", (12, 8), "white"))
    result = desktop_actions.perform("screenshot", "")
    from pathlib import Path

    destination = Path(result["path"])
    assert destination.parent == tmp_path / "screenshots"
    with Image.open(destination) as saved:
        assert saved.size == (12, 8)
    with pytest.raises(ValueError):
        desktop_actions.perform("screenshot-open", str(tmp_path / "outside.png"))
