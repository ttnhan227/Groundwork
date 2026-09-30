"""Groundwork Cloud - Synchronization & Account API for Google Cloud Run."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_cloud_settings
from app.core.database import Base, engine
from app.routers.auth import auth_router
from app.routers.devices import devices_router
from app.routers.sync import sync_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("groundwork.cloud")
settings = get_cloud_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Initializing Groundwork Cloud schema...")
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Lightweight metadata synchronization backend for Groundwork desktop.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(devices_router)
app.include_router(sync_router)


@app.get("/health", tags=["System"])
def health_check() -> dict[str, str]:
    return {"status": "healthy", "service": "groundwork-cloud-sync"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8080, reload=True)
