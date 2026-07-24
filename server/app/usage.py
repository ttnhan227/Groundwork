from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import AIUsageRecord, User


async def record_ai_usage(user: User, feature: str, session: AsyncSession, cached: bool = False) -> None:
    today = datetime.now(UTC).date()
    used = await session.scalar(
        select(func.count(AIUsageRecord.id)).where(
            AIUsageRecord.owner_id == user.id,
            func.date(AIUsageRecord.created_at) == today,
            AIUsageRecord.cached.is_(False),
        )
    )
    if not cached and (used or 0) >= get_settings().ai_daily_request_limit:
        raise HTTPException(status_code=429, detail="Daily AI request limit reached")
    session.add(AIUsageRecord(owner_id=user.id, feature=feature, cached=cached))
