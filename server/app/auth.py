import asyncio
import logging
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.dependencies import current_user
from app.models import RefreshToken, User
from app.schemas import GoogleLoginRequest, LoginRequest, RefreshRequest, RegisterRequest, TokenResponse, UserResponse
from app.security import create_access_token, create_refresh_token, hash_password, hash_token, verify_password

router = APIRouter(prefix="/auth", tags=["Authentication"])
logger = logging.getLogger(__name__)


def verify_google_credential(credential: str, client_id: str) -> dict:
    if not client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    try:
        claims = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            client_id,
            clock_skew_in_seconds=10,
        )
    except (ValueError, GoogleAuthError) as error:
        logger.warning(
            "google_credential_verification_failed: %s: %s",
            type(error).__name__,
            error,
        )
        raise HTTPException(status_code=401, detail="Invalid Google credential") from error
    if not claims.get("sub") or not claims.get("email") or claims.get("email_verified") is not True:
        raise HTTPException(status_code=401, detail="Google account email is not verified")
    return claims


async def issue_tokens(user: User, session: AsyncSession) -> TokenResponse:
    raw_refresh = create_refresh_token()
    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw_refresh),
            expires_at=datetime.now(UTC) + timedelta(days=get_settings().refresh_token_days),
        )
    )
    await session.commit()
    return TokenResponse(access_token=create_access_token(user.id), refresh_token=raw_refresh, user=UserResponse.model_validate(user))


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, session: AsyncSession = Depends(get_session)) -> TokenResponse:
    if not get_settings().registration_enabled:
        raise HTTPException(status_code=403, detail="Public registration is currently disabled")
    existing = await session.scalar(select(User).where(User.email == payload.email.lower()))
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(email=payload.email.lower(), display_name=payload.display_name.strip(), password_hash=hash_password(payload.password))
    session.add(user)
    await session.flush()
    return await issue_tokens(user, session)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, session: AsyncSession = Depends(get_session)) -> TokenResponse:
    user = await session.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="This account is disabled")
    return await issue_tokens(user, session)


@router.post("/google", response_model=TokenResponse)
async def google_login(payload: GoogleLoginRequest, session: AsyncSession = Depends(get_session)) -> TokenResponse:
    settings = get_settings()
    claims = await asyncio.to_thread(verify_google_credential, payload.credential, settings.google_client_id)
    google_sub = str(claims["sub"])
    email = str(claims["email"]).lower()

    user = await session.scalar(select(User).where(User.google_sub == google_sub))
    if user is None:
        user = await session.scalar(select(User).where(User.email == email))
        if user is not None:
            google_is_authoritative = email.endswith("@gmail.com") or bool(claims.get("hd"))
            if not google_is_authoritative:
                raise HTTPException(
                    status_code=409,
                    detail="Sign in with your password before linking this Google account",
                )
            if user.google_sub and user.google_sub != google_sub:
                raise HTTPException(status_code=409, detail="This email is linked to another Google account")
            user.google_sub = google_sub
        else:
            if not settings.registration_enabled:
                raise HTTPException(status_code=403, detail="Public registration is currently disabled")
            user = User(
                email=email,
                display_name=str(claims.get("name") or email.split("@", 1)[0])[:120],
                google_sub=google_sub,
                password_hash=hash_password(secrets.token_urlsafe(32)),
            )
            session.add(user)
            await session.flush()

    if user.email != email:
        raise HTTPException(status_code=409, detail="Google account identity does not match the linked user")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="This account is disabled")
    return await issue_tokens(user, session)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, session: AsyncSession = Depends(get_session)) -> TokenResponse:
    token = await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(payload.refresh_token)))
    if token is None or token.revoked_at is not None or token.expires_at < datetime.now(UTC):
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    token.revoked_at = datetime.now(UTC)
    user = await session.get(User, token.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="This account is disabled")
    return await issue_tokens(user, session)


@router.post("/logout", status_code=204)
async def logout(payload: RefreshRequest, session: AsyncSession = Depends(get_session)) -> None:
    token = await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(payload.refresh_token)))
    if token:
        token.revoked_at = datetime.now(UTC)
        await session.commit()


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(current_user)) -> User:
    return user
