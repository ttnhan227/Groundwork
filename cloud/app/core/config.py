"""Groundwork Cloud Backend - Configuration Settings.

Lightweight synchronization backend deployed to Google Cloud Run with PostgreSQL.
"""

from __future__ import annotations

from pydantic import Field, model_validator
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
    access_token_expire_minutes: int = 60 * 24 * 30  # 30 days session

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
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


_cloud_settings: CloudSettings | None = None


def get_cloud_settings() -> CloudSettings:
    global _cloud_settings
    if _cloud_settings is None:
        _cloud_settings = CloudSettings()
    return _cloud_settings
