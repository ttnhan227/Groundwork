from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Groundwork API"
    environment: str = "development"
    database_url: str = "postgresql+asyncpg://groundwork:groundwork@postgres:5432/groundwork"
    jwt_secret: str = "change-me-in-production"
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "groundwork"
    minio_secret_key: str = "groundwork-secret"
    minio_secure: bool = False
    minio_region: str = "us-east-1"
    minio_bucket_originals: str = "original-documents"
    redis_url: str = "redis://redis:6379/0"
    max_file_size_mb: int = 50
    max_page_count: int = 500
    ocr_text_density_threshold: int = 40
    ocr_language: str = "eng"
    embedding_provider: str = "api"
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 1024
    chunk_size: int = 900
    chunk_overlap: int = 150
    rag_top_k: int = 6
    llm_api_key: str = ""
    llm_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    llm_model: str = "gemini-flash-latest"
    vision_model: str = "gemini-flash-latest"
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
    google_client_id: str = ""
    admin_email: str = ""
    admin_password: str = ""
    cors_origins: str = "http://localhost:5173,http://localhost:3000,http://localhost:8080"

    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
