"""Groundwork Cloud - Synchronization & Account API for Google Cloud Run."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Uuid, inspect

from app.hosted.core.config import get_cloud_settings
from app.hosted.core.database import Base, engine
from app.hosted.routers.auth import auth_router
from app.hosted.routers.devices import devices_router
from app.hosted.routers.google_desktop import router as google_desktop_router
from app.hosted.routers.sync import sync_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("groundwork.cloud")
settings = get_cloud_settings()


def initialize_schema(bind):
    # Older hosted databases use native UUID user IDs. Match that existing
    # key when adding tables, while retaining string IDs in fresh databases.
    inspector = inspect(bind)
    if inspector.has_table("users"):
        user_id_type = next(column["type"] for column in inspector.get_columns("users") if column["name"] == "id")
        if isinstance(user_id_type, Uuid):
            for table in Base.metadata.tables.values():
                for column in table.columns:
                    if (table.name == "users" and column.name == "id") or any(
                        key.target_fullname == "users.id" for key in column.foreign_keys
                    ):
                        column.type = Uuid(as_uuid=False)
    Base.metadata.create_all(bind=bind)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Initializing Groundwork Cloud schema...")
    initialize_schema(engine)
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Lightweight metadata synchronization backend for Groundwork desktop.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(google_desktop_router)
app.include_router(devices_router)
app.include_router(sync_router)


@app.get("/health", tags=["System"])
def health_check() -> dict[str, str]:
    return {"status": "healthy", "service": "groundwork-cloud-sync"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8080, reload=True)
