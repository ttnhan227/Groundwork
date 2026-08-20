"""User and account data repository."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select

from app.models import User, UserRole
from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    """Data access operations for Users and Preferences."""

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return await self.session.scalar(select(User).where(User.id == user_id))

    async def get_by_email(self, email: str) -> User | None:
        return await self.session.scalar(select(User).where(User.email == email.strip().lower()))

    async def create(self, email: str, password_hash: str, display_name: str, role: str | UserRole = UserRole.USER, google_sub: str | None = None) -> User:
        user_role = role if isinstance(role, UserRole) else UserRole(role) if role in UserRole._value2member_map_ else UserRole.USER
        user = User(
            email=email.strip().lower(),
            password_hash=password_hash,
            display_name=display_name.strip(),
            role=user_role,
            is_active=True,
            google_sub=google_sub,
            preferences={},
        )
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def list_all(self) -> Sequence[User]:
        result = await self.session.scalars(select(User).order_by(User.created_at))
        return result.all()

    async def update(self, user: User) -> User:
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def get_preferences(self, user_id: uuid.UUID) -> dict:
        user = await self.get_by_id(user_id)
        if user is None or not user.preferences:
            return {}
        return user.preferences

    async def upsert_preferences(self, user_id: uuid.UUID, data: dict) -> dict:
        user = await self.get_by_id(user_id)
        if user is None:
            raise ValueError("User not found")
        current_pref = user.preferences or {}
        current_pref.update(data)
        user.preferences = current_pref
        await self.update(user)
        return current_pref
