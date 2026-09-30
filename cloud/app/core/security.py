"""Security, password hashing, and JWT token handling for Groundwork Cloud."""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from app.core.config import get_cloud_settings


def hash_password(password: str) -> str:
    """Hashes a password with SHA256 and salt for lightweight cross-platform compatibility."""
    salt = "gw-salt-2026"
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against the stored hash."""
    return hash_password(plain_password) == hashed_password


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    """Generates a signed JWT access token."""
    settings = get_cloud_settings()
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Decodes and validates a JWT token."""
    settings = get_cloud_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return payload
    except Exception:
        return None
