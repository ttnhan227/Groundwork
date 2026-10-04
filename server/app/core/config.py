"""Groundwork Local Core Configuration.

Defines local runtime settings, database locations, default ignore patterns,
and AI provider parameters.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Local Groundwork configuration settings."""

    app_name: str = "Groundwork Local"
    app_version: str = "1.0.0"
    environment: str = Field(default="development", alias="ENVIRONMENT")

    # Local filesystem storage
    data_dir: Path = Field(
        default_factory=lambda: Path(
            os.environ.get("GROUNDWORK_DATA_DIR", str(Path.home() / ".groundwork"))
        )
    )
    database_path: Path | None = None

    core_token: str | None = Field(default=None, alias="GROUNDWORK_CORE_TOKEN")

    # CORS settings for Tauri and local dev
    cors_origins: list[str] | str = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:1420",
        "tauri://localhost",
        "http://tauri.localhost",
        "http://127.0.0.1:1420",
        "http://127.0.0.1:5173",
    ]

    @property
    def cors_origin_list(self) -> list[str]:
        if isinstance(self.cors_origins, list):
            return self.cors_origins
        if isinstance(self.cors_origins, str):
            if self.cors_origins.startswith("["):
                import json
                try:
                    return json.loads(self.cors_origins)
                except Exception:
                    pass
            return [x.strip() for x in self.cors_origins.split(",") if x.strip()]
        return []

    # Default ignored directories and file patterns
    default_ignore_patterns: list[str] = [
        "node_modules",
        ".git",
        "__pycache__",
        ".venv",
        "venv",
        "env",
        ".pytest_cache",
        ".ruff_cache",
        "dist",
        "build",
        "target",
        "bin",
        "obj",
        ".idea",
        ".vscode",
        ".next",
        ".nuxt",
        "coverage",
        ".turbo",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "*.pyc",
        "*.exe",
        "*.dll",
        "*.so",
        "*.dylib",
        "*.zip",
        "*.tar",
        "*.gz",
        "*.iso",
        "*.bin",
        "*.png",
        "*.jpg",
        "*.jpeg",
        "*.gif",
        "*.ico",
        "*.svg",
        "*.mp4",
        "*.mp3",
        "*.wav",
        "*.mov",
        "*.avi",
        "*.woff",
        "*.woff2",
        "*.ttf",
        "*.eot",
    ]

    # File size limit for text indexing (5 MB)
    max_file_size_bytes: int = 5 * 1024 * 1024

    # AI Configuration
    ai_provider: str = Field(default="local", alias="AI_PROVIDER")  # local, ollama, openai, gemini
    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    ollama_model: str = Field(default="llama3", alias="OLLAMA_MODEL")
    ollama_embedding_model: str = Field(default="nomic-embed-text", alias="OLLAMA_EMBEDDING_MODEL")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4o-mini", alias="OPENAI_MODEL")
    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-3.8-flash", alias="GEMINI_MODEL")

    # Cloud Sync Configuration (Optional)
    cloud_sync_enabled: bool = Field(default=False, alias="CLOUD_SYNC_ENABLED")
    cloud_sync_url: str = Field(
        default_factory=lambda: (
            "https://groundwork-api-597984371188.asia-southeast1.run.app"
            if getattr(sys, "frozen", False) else "http://localhost:8080"
        ),
        alias="CLOUD_SYNC_URL",
    )
    cloud_sync_token: str | None = Field(default=None, alias="CLOUD_SYNC_TOKEN")
    device_id: str | None = Field(default=None, alias="GROUNDWORK_DEVICE_ID")

    model_config = {
        "env_file": None if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[3] / ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    def get_database_path(self) -> Path:
        """Returns the absolute path to the local SQLite database."""
        if self.database_path:
            return Path(self.database_path).expanduser().resolve()
        self.data_dir = self.data_dir.expanduser().resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return self.data_dir / "groundwork.db"


_settings: Settings | None = None


def get_settings() -> Settings:
    """Singleton getter for application settings."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
