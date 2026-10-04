"""System-browser Google sign-in with expiring, single-use desktop handoff."""
import hashlib
import json
import secrets
import time

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.hosted.core.config import get_cloud_settings
from app.hosted.core.database import get_db
from app.hosted.models.entities import GoogleDesktopSession, User
from app.hosted.routers.auth import (
    GoogleLoginRequest,
    account_token,
    get_current_user,
    google_login,
    link_google,
    verified_google_claims,
)

router = APIRouter(prefix="/auth/google/desktop", tags=["Auth"])


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class StartRequest(BaseModel):
    link: bool = False


class SessionRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    secret: str = Field(min_length=1, max_length=128)


class CompleteRequest(SessionRequest):
    id_token: str = Field(min_length=1, max_length=16384)


def find_session(db, session_id, secret, browser=False):
    session = db.get(GoogleDesktopSession, session_id)
    expected = session.browser_hash if browser and session else session.poll_hash if session else ""
    if not session or not secrets.compare_digest(expected, digest(secret)):
        raise HTTPException(status_code=404, detail="Sign-in session not found")
    if session.expires_at <= int(time.time()) or session.consumed:
        raise HTTPException(status_code=410, detail="Sign-in session expired; start again")
    return session


@router.post("/start")
def start(req: StartRequest, authorization: str | None = Header(None), db: Session = Depends(get_db)):
    if not get_cloud_settings().google_client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    link_user = get_current_user(authorization, db) if req.link else None
    session_id, poll_secret, browser_secret = (secrets.token_urlsafe(32) for _ in range(3))
    # Expired handoffs contain no reusable account credentials.
    db.query(GoogleDesktopSession).filter(GoogleDesktopSession.expires_at < int(time.time())).delete()
    session = GoogleDesktopSession(
        id=session_id, poll_hash=digest(poll_secret), browser_hash=digest(browser_secret),
        nonce=secrets.token_urlsafe(32), expires_at=int(time.time()) + 300,
        link_user_id=link_user.id if link_user else None,
    )
    db.add(session)
    db.commit()
    return {"session_id": session_id, "secret": poll_secret, "expires_in": 300,
            "browser_path": f"/auth/google/desktop/page?session_id={session_id}&secret={browser_secret}"}


@router.get("/page", response_class=HTMLResponse, name="google_desktop_page")
def page(session_id: str, secret: str, db: Session = Depends(get_db)):
    session = find_session(db, session_id, secret, browser=True)
    config = json.dumps({"client_id": get_cloud_settings().google_client_id, "nonce": session.nonce,
                         "session_id": session_id, "secret": secret}).replace("<", "\\u003c")
    script_nonce = secrets.token_urlsafe(24)
    html = """<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Groundwork — Google sign-in</title>
    <style>body{margin:0;background:#f7f5f0;color:#262522;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}main{max-width:420px;margin:24px;padding:36px;background:#fffdf8;border:1px solid #dfdbd2;border-radius:12px}h1{font-family:Georgia,serif;font-size:28px}p{line-height:1.6}#status{color:#555;font-size:14px}</style>
    </head><body><main><h1>Sign in to Groundwork</h1>
    <p>Continue with Google, then return to the desktop app. This connects your account for optional sync.</p>
    <div id="google-button"></div><p id="status" role="status">Loading Google sign-in…</p></main>
    <script src="https://accounts.google.com/gsi/client" async defer></script>
    <script nonce="SCRIPT_NONCE">
    const config = CONFIG;
    let attempts = 0;
    function initialize() {
      if (!window.google?.accounts?.id) {
        if (++attempts > 60) { document.getElementById('status').textContent = 'Unable to load Google sign-in. Check your connection and reload this page.'; return; }
        setTimeout(initialize, 250); return;
      }
      google.accounts.id.initialize({client_id:config.client_id, nonce:config.nonce, callback:async result => {
        const status = document.getElementById('status'); status.textContent = 'Connecting your account…';
        try {
          const response = await fetch('./complete', {method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({session_id:config.session_id, secret:config.secret, id_token:result.credential})});
          const data = await response.json().catch(() => ({detail:'The account service is temporarily unavailable. Please try again.'}));
          if (!response.ok) throw new Error(data.detail || 'Sign-in failed');
          status.textContent = 'Connected. Return to Groundwork. You can close this tab.';
          document.getElementById('google-button').replaceChildren();
        } catch (error) { status.textContent = error.message; }
      }});
      google.accounts.id.renderButton(document.getElementById('google-button'), {theme:'outline', size:'large'});
      document.getElementById('status').textContent = 'Choose your Google account to continue.';
    }
    initialize();
    </script></body></html>""".replace("SCRIPT_NONCE", script_nonce).replace("CONFIG", config)
    return HTMLResponse(html, headers={
        "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
        "Content-Security-Policy": f"default-src 'self'; script-src 'self' 'nonce-{script_nonce}' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://accounts.google.com; img-src 'self' https://*.googleusercontent.com; base-uri 'none'; frame-ancestors 'none'",
    })


@router.post("/complete")
def complete(req: CompleteRequest, db: Session = Depends(get_db)):
    session = find_session(db, req.session_id, req.secret, browser=True)
    token = GoogleLoginRequest(id_token=req.id_token)
    claims = verified_google_claims(token)
    if not claims.nonce or not secrets.compare_digest(claims.nonce, session.nonce):
        raise HTTPException(status_code=401, detail="Google sign-in nonce does not match")
    if session.user_id:
        raise HTTPException(status_code=409, detail="Sign-in already completed")
    if session.link_user_id:
        user = db.get(User, session.link_user_id)
        result = link_google(token, user, db)
    else:
        result = google_login(token, db)
    session.user_id = result.user_id
    db.commit()
    return {"status": "connected"}


@router.post("/poll")
def poll(req: SessionRequest, db: Session = Depends(get_db)):
    session = find_session(db, req.session_id, req.secret)
    if not session.user_id:
        return {"status": "pending"}
    # Conditional update makes concurrent poll requests unable to redeem twice.
    updated = db.query(GoogleDesktopSession).filter(
        GoogleDesktopSession.id == session.id, GoogleDesktopSession.consumed == 0,
    ).update({"consumed": 1})
    if not updated:
        db.rollback()
        raise HTTPException(status_code=410, detail="Sign-in session already consumed")
    user = db.get(User, session.user_id)
    db.commit()
    return {"status": "authenticated", **account_token(user).model_dump()}
