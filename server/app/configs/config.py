from functools import lru_cache
from typing import Self

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Safe operational defaults
    app_name: str = "Groundwork API"
    environment: str = "development"
    database_url: str = "postgresql+asyncpg://groundwork:groundwork@postgres:5432/groundwork"
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    minio_endpoint: str = "minio:9000"
    minio_secure: bool = False
    minio_region: str = "us-east-1"
    minio_bucket_originals: str = "original-documents"
    redis_url: str = "redis://redis:6379/0"
    max_file_size_mb: int = 50
    max_page_count: int = 500
    ocr_text_density_threshold: int = 40
    ocr_language: str = "eng"
    embedding_provider: str = "api"
    embedding_dimensions: int = 1024
    chunk_size: int = 900
    chunk_overlap: int = 150
    rag_top_k: int = 6
    llm_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    vision_max_pages: int = 6
    llm_timeout_seconds: int = 60
    ai_daily_request_limit: int = 50
    ai_global_daily_request_limit: int = 500
    request_rate_limit_per_minute: int = 120
    registration_rate_limit_per_hour: int = 5
    ai_rate_limit_per_minute: int = 10
    max_documents_per_user: int = 100
    daily_upload_limit_per_user: int = 10
    global_daily_upload_limit: int = 100
    registration_enabled: bool = True
    cors_origins: str = "http://localhost:5173,http://localhost:3000,http://localhost:8080"

    # Environment-specific / Sensitive secrets (no hardcoded credentials)
    jwt_secret: str = ""
    minio_access_key: str = ""
    minio_secret_key: str = ""
    embedding_model: str = ""
    llm_api_key: str = ""
    llm_model: str = ""
    vision_model: str = ""
    google_client_id: str = ""
    admin_email: str = ""
    admin_password: str = ""

    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    @model_validator(mode="after")
    def validate_environment_and_secrets(self) -> Self:
        is_prod = self.environment.lower() in ("production", "prod")
        if is_prod:
            if not self.jwt_secret or self.jwt_secret in ("change-me-in-production", "dev-insecure-jwt-secret"):
                raise ValueError("JWT_SECRET must be set to a secure random string when ENVIRONMENT=production")
        elif not self.jwt_secret:
            # Safe local fallback for local development / unit testing when no .env exists
            self.jwt_secret = "dev-insecure-jwt-secret-for-local-development-only"
        
        # Local development fallback for MinIO if not configured in .env
        if not is_prod:
            if not self.minio_access_key:
                self.minio_access_key = "groundwork"
            if not self.minio_secret_key:
                self.minio_secret_key = "groundwork-secret"

        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
