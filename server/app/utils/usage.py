from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.configs.config import get_settings
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
    settings = get_settings()
    if not cached and (used or 0) >= settings.ai_daily_request_limit:
        raise HTTPException(status_code=429, detail="Daily AI request limit reached")
    global_used = await session.scalar(
        select(func.count(AIUsageRecord.id)).where(
            func.date(AIUsageRecord.created_at) == today,
            AIUsageRecord.cached.is_(False),
        )
    )
    if not cached and (global_used or 0) >= settings.ai_global_daily_request_limit:
        raise HTTPException(status_code=429, detail="The preview has reached its daily AI limit")
    session.add(AIUsageRecord(owner_id=user.id, feature=feature, cached=cached))
