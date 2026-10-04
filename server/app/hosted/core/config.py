"""Groundwork Cloud Backend - Configuration Settings.

Lightweight synchronization backend deployed to Google Cloud Run with PostgreSQL.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings


class CloudSettings(BaseSettings):
    """Cloud backend settings."""

    app_name: str = "Groundwork Cloud Sync"
    app_version: str = "1.0.0"
    environment: str = Field(default="development", alias="ENVIRONMENT")

    # PostgreSQL / SQLite connection URL
    database_url: str = Field(
        default="sqlite:///./groundwork_cloud.db",
        alias="DATABASE_URL",
    )

    jwt_secret: str = Field(default="dev-cloud-jwt-secret-groundwork-2026", alias="JWT_SECRET")
    jwt_algorithm: str = "HS256"
    google_client_id: str = Field(default="", alias="GOOGLE_CLIENT_ID")
    database_schema: str = Field(default="groundwork", alias="GROUNDWORK_DATABASE_SCHEMA", pattern=r"^[a-z][a-z0-9_]{0,62}$")
    access_token_expire_minutes: int = Field(
        default=60 * 24 * 30,
        gt=0,
        validation_alias=AliasChoices("ACCESS_TOKEN_MINUTES", "ACCESS_TOKEN_EXPIRE_MINUTES"),
    )

    cors_origins: list[str] | str = ["*"]

    @model_validator(mode="after")
    def production_configuration(self):
        if self.environment == "production" and (self.jwt_secret.startswith("dev-") or len(self.jwt_secret) < 32):
            raise ValueError("Production JWT_SECRET must contain at least 32 random characters")
        if "+asyncpg" in self.database_url:
            raise ValueError("Cloud requires a synchronous PostgreSQL driver (postgresql+psycopg2)")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        if isinstance(self.cors_origins, list):
            return self.cors_origins
        if isinstance(self.cors_origins, str):
            v = self.cors_origins.strip()
            if v.startswith("[") and v.endswith("]"):
                import json
                try:
                    return json.loads(v)
                except Exception:
                    pass
            return [x.strip() for x in v.split(",") if x.strip()]
        return ["*"]

    model_config = {
        "env_file": Path(__file__).resolve().parents[4] / ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


_cloud_settings: CloudSettings | None = None


def get_cloud_settings() -> CloudSettings:
    global _cloud_settings
    if _cloud_settings is None:
        _cloud_settings = CloudSettings()
    return _cloud_settings
