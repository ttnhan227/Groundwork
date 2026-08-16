"""User notifications business logic service."""

from __future__ import annotations

from collections.abc import Sequence

from app.models import Notification, User
from app.repositories.notification_repository import NotificationRepository


class NotificationService:
    """Business logic for user notifications and unread counts."""

    def __init__(self, notification_repo: NotificationRepository) -> None:
        self.notification_repo = notification_repo

    async def list_notifications(self, user: User, limit: int = 50) -> Sequence[Notification]:
        return await self.notification_repo.list_for_user(user, limit=limit)

    async def count_unread(self, user: User) -> int:
        return await self.notification_repo.count_unread(user)

    async def mark_all_as_read(self, user: User) -> None:
        await self.notification_repo.mark_all_read(user)
