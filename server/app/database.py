from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
# Celery executes each synchronous task through a fresh asyncio.run() loop.
# NullPool prevents asyncpg connections created by one task loop from being
# reused by a later task loop, which otherwise raises "Future attached to a
# different loop" after multiple uploads.
engine = create_async_engine(settings.database_url, pool_pre_ping=True, poolclass=NullPool)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
