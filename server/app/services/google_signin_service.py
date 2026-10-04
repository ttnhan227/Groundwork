"""Google browser handoff; polling secrets stay inside the private local engine."""
import threading
import time
import webbrowser

import httpx
from fastapi import HTTPException

from app.core.config import get_settings
from app.services.preferences_service import PreferencesService, validate_url

_sessions = {}
_lock = threading.Lock()


def hosted_request(url, path, body, token=None):
    try:
        with httpx.Client(timeout=10) as client:
            response = client.post(url + path, json=body, headers={"Authorization": f"Bearer {token}"} if token else {})
        if response.status_code != 200:
            detail = response.json().get("detail", "Google sign-in failed")
            raise HTTPException(status_code=response.status_code, detail=str(detail)[:300])
        return response.json()
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(status_code=502, detail="Unable to reach the account service") from None


def start_google(url, link=False):
    url = validate_url(url)
    settings = get_settings()
    if link and (url != settings.cloud_sync_url.rstrip("/") or not settings.cloud_sync_token):
        raise HTTPException(status_code=401, detail="Sign in to this account service before linking Google")
    result = hosted_request(url, "/auth/google/desktop/start", {"link": link}, settings.cloud_sync_token if link else None)
    path = result.get("browser_path", "")
    if not path.startswith("/auth/google/desktop/page?"):
        raise HTTPException(status_code=502, detail="Account service returned an invalid sign-in link")
    session_id = result["session_id"]
    with _lock:
        for key in list(_sessions):
            if _sessions[key]["expires"] <= time.time():
                del _sessions[key]
        _sessions[session_id] = {"url": url, "secret": result["secret"], "expires": time.time() + 300}
    if not webbrowser.open(url + path):
        with _lock:
            _sessions.pop(session_id, None)
        raise HTTPException(status_code=503, detail="Unable to open your browser; use the installed desktop app")
    return {"session_id": session_id, "status": "pending"}


def poll_google(session_id):
    # Serialize redemption and preference persistence for concurrent local polls.
    with _lock:
        session = _sessions.get(session_id)
        if not session or session["expires"] <= time.time():
            _sessions.pop(session_id, None)
            raise HTTPException(status_code=410, detail="Google sign-in expired; start again")
        result = hosted_request(session["url"], "/auth/google/desktop/poll", {"session_id": session_id, "secret": session["secret"]})
        if result.get("status") == "authenticated":
            PreferencesService().update({"cloud_sync_url": session["url"], "cloud_sync_token": result["access_token"], "cloud_sync_enabled": True})
            del _sessions[session_id]
            return {"status": "authenticated"}
        return {"status": "pending"}


def cancel_google(session_id):
    with _lock:
        _sessions.pop(session_id, None)
    return {"status": "cancelled"}
