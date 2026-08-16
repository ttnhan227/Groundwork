"""Base repository class with standard database session management."""

from __future__ import annotations

from typing import Generic, TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

ModelType = TypeVar("ModelType")


class BaseRepository(Generic[ModelType]):
    """Generic async repository for SQLAlchemy models."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
