"""Notifications data repository."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import func, select, update

from app.models import Notification, User
from app.repositories.base import BaseRepository


class NotificationRepository(BaseRepository[Notification]):
    """Data access operations for User Notifications."""

    async def list_for_user(self, user: User, limit: int = 50) -> Sequence[Notification]:
        result = await self.session.scalars(
            select(Notification)
            .where(Notification.user_id == user.id)
            .order_by(Notification.created_at.desc())
            .limit(limit)
        )
        return result.all()

    async def count_unread(self, user: User) -> int:
        result = await self.session.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user.id,
                Notification.is_read.is_(False),
            )
        )
        return int(result or 0)

    async def mark_all_read(self, user: User) -> None:
        await self.session.execute(
            update(Notification)
            .where(Notification.user_id == user.id, Notification.is_read.is_(False))
            .values(is_read=True)
        )
        await self.session.commit()

    async def create(self, notification: Notification) -> Notification:
        self.session.add(notification)
        await self.session.commit()
        await self.session.refresh(notification)
        return notification
