from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "InsightPDF API"
    environment: str = "development"
    database_url: str = "postgresql+asyncpg://insightpdf:insightpdf@postgres:5432/insightpdf"
    jwt_secret: str = "change-me-in-production"
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "insightpdf"
    minio_secret_key: str = "insightpdf-secret"
    minio_secure: bool = False
    minio_bucket_originals: str = "original-documents"
    redis_url: str = "redis://redis:6379/0"
    max_file_size_mb: int = 50
    max_page_count: int = 500
    ocr_text_density_threshold: int = 40
    ocr_language: str = "eng"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimensions: int = 384
    chunk_size: int = 900
    chunk_overlap: int = 150
    rag_top_k: int = 6
    llm_api_key: str = ""
    llm_base_url: str = "https://api.mistral.ai/v1"
    llm_model: str = "mistral-small-latest"
    llm_timeout_seconds: int = 60
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
