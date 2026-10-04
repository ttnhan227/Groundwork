"""Database connection and session factory for Groundwork Cloud."""

from __future__ import annotations

from typing import Generator

from sqlalchemy import MetaData, create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.hosted.core.config import get_cloud_settings

settings = get_cloud_settings()
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
# Poolers can ignore startup search_path options. Qualify every PostgreSQL
# table explicitly so legacy public tables can never be selected accidentally.
Base = declarative_base(metadata=MetaData(
    schema=settings.database_schema if engine.dialect.name == "postgresql" else None,
))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
