"""Security, password hashing, and JWT token handling for Groundwork Cloud."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from app.hosted.core.config import get_cloud_settings


def hash_password(password: str) -> str:
    """Use a unique salt and a deliberately expensive password KDF."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 600_000).hex()
    return f"pbkdf2_sha256$600000${salt}${digest}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        algorithm, iterations, salt, digest = hashed_password.split("$")
        if algorithm != "pbkdf2_sha256" or int(iterations) != 600_000:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", plain_password.encode(), bytes.fromhex(salt), int(iterations)).hex()
        return hmac.compare_digest(actual, digest)
    except (ValueError, TypeError):
        # Existing accounts can sign in once; the auth route upgrades this hash.
        legacy = hashlib.sha256(f"gw-salt-2026:{plain_password}".encode()).hexdigest()
        return hmac.compare_digest(legacy, hashed_password)


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
