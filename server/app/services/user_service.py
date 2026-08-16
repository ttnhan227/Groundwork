"""User profile and account administration service."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from app.models import User, UserRole
from app.repositories.user_repository import UserRepository
from app.security import hash_password, verify_password


class UserService:
    """Business logic for user profiles, password changes, and preferences."""

    def __init__(self, user_repo: UserRepository) -> None:
        self.user_repo = user_repo

    async def update_profile(self, user: User, display_name: str) -> User:
        display_name = display_name.strip()
        if len(display_name) < 2:
            raise ValueError("Display name must have at least 2 characters.")
        user.display_name = display_name
        return await self.user_repo.update(user)

    async def change_password(self, user: User, current_password: str, new_password: str) -> None:
        if not verify_password(current_password, user.password_hash):
            raise ValueError("Current password does not match.")
        if len(new_password) < 8:
            raise ValueError("New password must contain at least 8 characters.")
        user.password_hash = hash_password(new_password)
        await self.user_repo.update(user)

    async def toggle_active_status(self, admin: User, target_user_id: uuid.UUID) -> User:
        if admin.role != UserRole.ADMIN:
            raise PermissionError("Admin access required.")
        target = await self.user_repo.get_by_id(target_user_id)
        if target is None:
            raise ValueError("User not found.")
        target.is_active = not target.is_active
        return await self.user_repo.update(target)

    async def list_all_users(self, admin: User) -> Sequence[User]:
        if admin.role != UserRole.ADMIN:
            raise PermissionError("Admin access required.")
        return await self.user_repo.list_all()

    async def get_preferences(self, user: User) -> dict:
        pref = await self.user_repo.get_preferences(user.id)
        if not pref:
            return {
                "compact_sidebar": False,
                "reduced_motion": False,
                "default_export_format": "pdf",
                "default_theme": "minimal",
                "interface_size": "comfortable",
            }
        return pref

    async def update_preferences(self, user: User, preferences_data: dict) -> dict:
        return await self.user_repo.upsert_preferences(user.id, preferences_data)
