"""Groundwork Local - FastAPI Application Core.

Local-first workspace search, project intelligence, and AI context engine.
"""

from __future__ import annotations

import logging
import secrets
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import get_settings
from app.database.local_db import get_db
from app.routers.api import (
    activity_router,
    ai_router,
    context_router,
    git_router,
    indexer_router,
    notes_router,
    projects_router,
    saved_searches_router,
    search_router,
    sync_router,
    system_router,
    workspaces_router,
)
from app.services.indexer_service import IndexerService
from app.services.watcher_service import WatcherService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("groundwork.local")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manages application lifecycle: DB init, watcher startup, and graceful shutdown."""
    from app.services.preferences_service import PreferencesService
    try:
        PreferencesService().load()
    except Exception:
        logger.warning("Private preferences could not be loaded; using environment defaults")
    logger.info("Initializing Groundwork Local database...")
    db = get_db()
    db.init_schema()

    logger.info("Starting workspace filesystem watcher...")
    watcher = WatcherService.get_instance()
    watcher.start()
    IndexerService.get_instance().start_indexing()

    yield

    logger.info("Shutting down Groundwork Local...")
    watcher.stop()
    from app.services.local_ai_service import LocalAIService
    if LocalAIService._instance:
        LocalAIService._instance.close()
    IndexerService.get_instance().cancel_indexing()
    IndexerService.get_instance().wait_for_completion()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Groundwork: Local-first workspace search and AI context tool for developers.",
    lifespan=lifespan,
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver", "tauri.localhost"])

# CORS configuration for Tauri desktop application and local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in settings.cors_origin_list if origin != "*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def protect_local_api(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin and origin not in settings.cors_origin_list:
        return JSONResponse({"detail": "Untrusted origin"}, status_code=403)
    if settings.core_token and request.method != "OPTIONS":
        supplied = request.headers.get("authorization", "")
        if not secrets.compare_digest(supplied, f"Bearer {settings.core_token}"):
            return JSONResponse({"detail": "Local core authentication required"}, status_code=401)
    return await call_next(request)


# Register Routers
app.include_router(system_router)
app.include_router(workspaces_router)
app.include_router(projects_router)
app.include_router(indexer_router)
app.include_router(search_router)
app.include_router(git_router)
app.include_router(activity_router)
app.include_router(context_router)
app.include_router(notes_router)
app.include_router(saved_searches_router)
app.include_router(ai_router)
app.include_router(sync_router)


@app.get("/health", tags=["System"])
def health_check() -> dict[str, str]:
    return {
        "status": "healthy",
        "service": "groundwork-local",
        "version": settings.app_version,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
