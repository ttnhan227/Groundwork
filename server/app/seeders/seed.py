"""Database seeders for InsightPDF development and testing."""

import asyncio
import logging

from sqlalchemy import select

from app.configs.config import get_settings
from app.database.database import SessionLocal
from app.models import User, UserRole
from app.utils.security import hash_password

logger = logging.getLogger("insightpdf.seeders")


async def seed_admin_user() -> None:
    settings = get_settings()
    if not settings.admin_email or not settings.admin_password:
        logger.info("No ADMIN_EMAIL / ADMIN_PASSWORD configured, skipping admin seeding.")
        return

    async with SessionLocal() as session:
        existing = await session.scalar(select(User).where(User.email == settings.admin_email))
        if existing:
            logger.info("Admin user %s already exists.", settings.admin_email)
            return

        admin = User(
            email=settings.admin_email,
            display_name="System Admin",
            password_hash=hash_password(settings.admin_password),
            role=UserRole.ADMIN,
            is_active=True,
        )
        session.add(admin)
        await session.commit()
        logger.info("Created default admin user: %s", settings.admin_email)


async def run_seeders() -> None:
    await seed_admin_user()


if __name__ == "__main__":
    asyncio.run(run_seeders())
