"""Idempotently create an optional administrator account."""

import asyncio

from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.models import User, UserRole
from app.security import hash_password


async def seed() -> None:
    settings = get_settings()
    if not settings.admin_email or not settings.admin_password:
        return
    async with SessionLocal() as session:
        admin = await session.scalar(select(User).where(User.email == settings.admin_email.lower()))
        if admin is None:
            session.add(User(
                email=settings.admin_email.lower(),
                display_name="InsightPDF Admin",
                password_hash=hash_password(settings.admin_password),
                role=UserRole.ADMIN,
            ))
            await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
