"""Authentication and authorization business logic service."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.config import get_settings
from app.models import RefreshToken, User
from app.repositories.user_repository import UserRepository
from app.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_token,
    verify_password,
)


class AuthService:
    """Business logic for user authentication, registration, tokens, and OAuth."""

    def __init__(self, user_repo: UserRepository) -> None:
        self.user_repo = user_repo
        self.settings = get_settings()

    async def register(self, email: str, password: str, display_name: str | None = None) -> tuple[User, str, str]:
        email = email.strip().lower()
        display_name = (display_name or email.split("@")[0]).strip()
        if len(display_name) < 2:
            raise ValueError("Display name must have at least 2 characters.")
        existing = await self.user_repo.get_by_email(email)
        if existing:
            raise ValueError("An account with this email already exists.")
        user = await self.user_repo.create(
            email=email,
            password_hash=hash_password(password),
            display_name=display_name,
            role="user",
        )
        access_token, refresh_token = await self._issue_tokens(user)
        return user, access_token, refresh_token

    async def login(self, email: str, password: str) -> tuple[User, str, str]:
        email = email.strip().lower()
        user = await self.user_repo.get_by_email(email)
        if user is None or not verify_password(password, user.password_hash):
            raise ValueError("Invalid email or password.")
        if not user.is_active:
            raise PermissionError("Account is inactive.")
        access_token, refresh_token = await self._issue_tokens(user)
        return user, access_token, refresh_token

    async def _issue_tokens(self, user: User) -> tuple[str, str]:
        raw_refresh = create_refresh_token()
        refresh_record = RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw_refresh),
            expires_at=datetime.now(UTC) + timedelta(days=self.settings.refresh_token_days),
        )
        self.user_repo.session.add(refresh_record)
        await self.user_repo.session.commit()
        access_token = create_access_token(user.id)
        return access_token, raw_refresh
