"""Authentication router for Groundwork Cloud Sync."""

from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from google.auth import exceptions as google_exceptions
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.hosted.core.config import get_cloud_settings
from app.hosted.core.database import get_db
from app.hosted.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.hosted.models.entities import GoogleIdentity, User

auth_router = APIRouter(prefix="/auth", tags=["Auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=256)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(min_length=1, max_length=16384)


class GoogleClaims(BaseModel):
    sub: str = Field(min_length=1, max_length=255)
    email: EmailStr


class GoogleRequest(Request):
    def __call__(self, *args, **kwargs):
        kwargs["timeout"] = 10
        return super().__call__(*args, **kwargs)


def verified_google_claims(req: GoogleLoginRequest) -> GoogleClaims:
    client_id = get_cloud_settings().google_client_id.strip()
    if not client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    try:
        claims = id_token.verify_oauth2_token(req.id_token, GoogleRequest(), client_id)
        if claims.get("email_verified") is not True:
            raise ValueError("Unverified email")
        return GoogleClaims.model_validate(claims)
    except google_exceptions.TransportError:
        raise HTTPException(status_code=503, detail="Google verification is temporarily unavailable") from None
    except (ValueError, google_exceptions.GoogleAuthError):
        raise HTTPException(status_code=401, detail="Invalid Google identity token") from None


def account_token(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token({"sub": user.id, "email": user.email}),
        user_id=user.id, email=user.email,
    )


def get_current_user(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> User:
    """Dependency validating the Bearer token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing authorization header")

    token = authorization.split(" ")[1]
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


@auth_router.post("/register", response_model=TokenResponse)
def register_user(req: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=req.email,
        hashed_password=hash_password(req.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": user.id, "email": user.email})
    return TokenResponse(access_token=token, user_id=user.id, email=user.email)


@auth_router.post("/login", response_model=TokenResponse)
def login_user(req: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.email == req.email).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid email or password")

    if not user.hashed_password.startswith("pbkdf2_sha256$"):
        user.hashed_password = hash_password(req.password)
        db.commit()
    token = create_access_token({"sub": user.id, "email": user.email})
    return TokenResponse(access_token=token, user_id=user.id, email=user.email)


@auth_router.get("/me")
def get_me(user: User = Depends(get_current_user)) -> dict[str, Any]:
    return {"id": user.id, "email": user.email, "created_at": user.created_at}


@auth_router.post("/google", response_model=TokenResponse)
def google_login(req: GoogleLoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    claims = verified_google_claims(req)
    identity = db.get(GoogleIdentity, claims.sub)
    if identity:
        return account_token(identity.user)
    if db.query(User).filter(User.email == claims.email).first():
        raise HTTPException(status_code=409, detail="Sign in to your existing account and link Google first")
    # An unknown random password preserves the existing non-null password column.
    user = User(email=claims.email, hashed_password=hash_password(secrets.token_urlsafe(64)))
    db.add(user)
    try:
        db.flush()
        db.add(GoogleIdentity(subject=claims.sub, user_id=user.id))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Account changed; retry sign-in") from None
    return account_token(user)


@auth_router.post("/google/link", response_model=TokenResponse)
def link_google(
    req: GoogleLoginRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TokenResponse:
    claims = verified_google_claims(req)
    if claims.email.casefold() != user.email.casefold():
        raise HTTPException(status_code=409, detail="Google email must match your account email")
    identity = db.get(GoogleIdentity, claims.sub)
    if identity and identity.user_id != user.id:
        raise HTTPException(status_code=409, detail="Google account is already linked")
    if not identity:
        db.add(GoogleIdentity(subject=claims.sub, user_id=user.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="Account already has a Google identity") from None
    return account_token(user)
