import uuid
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.auth import hash_password, verify_password
from app.controllers.auth import login
from app.controllers.users import change_password
from app.dtos.auth_dto import LoginRequest
from app.dtos.user_dto import PasswordChangeRequest, UserResponse
from app.models.enums import UserRole
from app.models.user import User

ROOT = Path(__file__).parents[1]


def test_user_model_has_password_default() -> None:
    table = User.__table__
    assert "has_password" in table.c
    col = table.c.has_password
    assert str(col.server_default.arg) == "true" or col.default.arg is True


def test_alembic_migration_0025_add_has_password() -> None:
    migration_file = ROOT.joinpath("alembic", "versions", "0025_add_has_password.py")
    assert migration_file.exists()
    content = migration_file.read_text(encoding="utf-8")
    assert 'down_revision = "0024_document_source_hash_unique"' in content
    assert 'add_column("users", sa.Column("has_password", sa.Boolean()' in content
    assert 'drop_column("users", "has_password")' in content


def test_user_response_dto_includes_has_password() -> None:
    user_google = User(
        id=uuid.uuid4(),
        email="googleuser@example.com",
        display_name="Google User",
        role=UserRole.USER,
        is_active=True,
        has_password=False,
        created_at=datetime.now(UTC),
    )
    dto_google = UserResponse.model_validate(user_google)
    assert dto_google.has_password is False

    user_regular = User(
        id=uuid.uuid4(),
        email="regularuser@example.com",
        display_name="Regular User",
        role=UserRole.USER,
        is_active=True,
        has_password=True,
        created_at=datetime.now(UTC),
    )
    dto_regular = UserResponse.model_validate(user_regular)
    assert dto_regular.has_password is True


@pytest.mark.asyncio
async def test_google_user_without_password_cannot_login_with_password() -> None:
    session = AsyncMock()
    user = User(
        id=uuid.uuid4(),
        email="google@example.com",
        display_name="Google Account",
        password_hash=hash_password("random_placeholder"),
        has_password=False,
        is_active=True,
    )
    session.scalar.return_value = user

    payload = LoginRequest(email="google@example.com", password="some_password")

    with pytest.raises(HTTPException) as exc_info:
        await login(payload, session=session)

    assert exc_info.value.status_code == 401
    assert "created with Google" in exc_info.value.detail


@pytest.mark.asyncio
async def test_google_user_can_set_password_without_current_password() -> None:
    session = AsyncMock()
    session.scalars.return_value = []
    user = User(
        id=uuid.uuid4(),
        email="google@example.com",
        display_name="Google Account",
        password_hash=hash_password("random_placeholder"),
        has_password=False,
        is_active=True,
    )

    payload = PasswordChangeRequest(current_password=None, new_password="MyNewSecurePassword123!")

    response = await change_password(payload, user=user, session=session)
    assert response.status_code == 204
    assert user.has_password is True
    assert verify_password("MyNewSecurePassword123!", user.password_hash)


@pytest.mark.asyncio
async def test_password_user_requires_valid_current_password() -> None:
    session = AsyncMock()
    session.scalars.return_value = []
    user = User(
        id=uuid.uuid4(),
        email="standard@example.com",
        display_name="Standard Account",
        password_hash=hash_password("ExistingPassword123!"),
        has_password=True,
        is_active=True,
    )

    # Missing current_password should fail with 422
    payload_missing = PasswordChangeRequest(current_password=None, new_password="BrandNewPassword123!")
    with pytest.raises(HTTPException) as exc_missing:
        await change_password(payload_missing, user=user, session=session)
    assert exc_missing.value.status_code == 422

    # Wrong current_password should fail with 422
    payload_wrong = PasswordChangeRequest(current_password="WrongPassword123!", new_password="BrandNewPassword123!")
    with pytest.raises(HTTPException) as exc_wrong:
        await change_password(payload_wrong, user=user, session=session)
    assert exc_wrong.value.status_code == 422

    # Correct current_password should succeed
    payload_correct = PasswordChangeRequest(current_password="ExistingPassword123!", new_password="BrandNewPassword123!")
    response = await change_password(payload_correct, user=user, session=session)
    assert response.status_code == 204
    assert user.has_password is True
    assert verify_password("BrandNewPassword123!", user.password_hash)
