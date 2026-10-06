"""Groundwork Cloud - Synchronization & Account API for Google Cloud Run."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Uuid, inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema

from app.hosted.core.config import get_cloud_settings
from app.hosted.core.database import Base, engine, get_db
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
    schema = Base.metadata.schema
    if schema:
        with bind.begin() as connection:
            connection.execute(CreateSchema(schema, if_not_exists=True))
    inspector = inspect(bind)
    if inspector.has_table("users", schema=schema):
        user_id_type = next(column["type"] for column in inspector.get_columns("users", schema=schema) if column["name"] == "id")
        if isinstance(user_id_type, Uuid):
            for table in Base.metadata.tables.values():
                for column in table.columns:
                    if (table.name == "users" and column.name == "id") or any(
                        key.target_fullname == "users.id" for key in column.foreign_keys
                    ):
                        column.type = Uuid(as_uuid=False)
    Base.metadata.create_all(bind=bind)
    # create_all adds missing tables, but cannot migrate existing columns.
    # Reject incompatible schemas before this revision can serve traffic.
    inspector = inspect(bind)
    for table in Base.metadata.tables.values():
        actual = {column['name'] for column in inspector.get_columns(table.name, schema=schema)}
        missing = set(table.columns.keys()) - actual
        if missing:
            raise RuntimeError(f"Hosted schema migration required for {table.name}: {sorted(missing)}")


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


@app.get("/ready", tags=["System"])
def readiness(db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    return {"status": "ready", "service": "groundwork-cloud-sync", "commit": os.getenv("GROUNDWORK_COMMIT", "local")}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8080, reload=True)
