from pathlib import Path

import pytest

from app.ai_orchestration import AIProviderError, _json_object
from app.models import JobStatus, User


def test_structured_provider_response_accepts_fenced_json() -> None:
    assert _json_object('```json\n{"answer": "grounded"}\n```') == {"answer": "grounded"}


def test_structured_provider_response_rejects_non_objects() -> None:
    with pytest.raises(AIProviderError):
        _json_object('["not", "an", "object"]')


def test_all_provider_http_calls_are_centralized() -> None:
    app = Path(__file__).parents[1] / "app"
    offenders = []
    for path in app.rglob("*.py"):
        if path.name == "ai_orchestration.py":
            continue
        source = path.read_text(encoding="utf-8")
        if "/chat/completions" in source or '"/embeddings"' in source:
            offenders.append(path.name)
    assert offenders == []


def test_jobs_and_users_expose_durable_redesign_state() -> None:
    assert JobStatus.CANCELLED.value == "cancelled"
    assert User.__table__.c.preferences.type.python_type is dict
    migration = Path(__file__).parents[1].joinpath("alembic", "versions", "0017_cancellable_jobs.py").read_text(encoding="utf-8")
    assert "CANCELLED" in migration
    assert '"preferences"' in migration


def test_generation_runs_through_a_cancellable_background_job() -> None:
    generation = Path(__file__).parents[1].joinpath("app", "controllers", "generation.py").read_text(encoding="utf-8")
    tasks = Path(__file__).parents[1].joinpath("app", "tasks", "tasks.py").read_text(encoding="utf-8")
    jobs = Path(__file__).parents[1].joinpath("app", "controllers", "jobs.py").read_text(encoding="utf-8")
    assert '@router.post("/jobs"' in generation
    assert '"ai_create"' in generation
    assert 'operation == "ai_create"' in tasks
    assert '@router.post("/status/{job_id}/cancel"' in jobs


def test_extract_error_detail_formats_provider_errors() -> None:
    import httpx
    from app.ai_orchestration import _extract_error_detail

    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(
        400,
        request=request,
        json={"error": {"message": "Please pass a valid API key", "type": "invalid_request_error"}},
    )
    exc = httpx.HTTPStatusError("Bad Request", request=request, response=response)
    detail = _extract_error_detail(exc)
    assert "AI provider error (400): Please pass a valid API key" in detail


@pytest.mark.asyncio
async def test_complete_raises_provider_error_without_fallback() -> None:
    from unittest.mock import patch
    import httpx
    from app.ai_orchestration import ai_orchestrator

    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(
        401,
        request=request,
        json={"detail": "Invalid API Key"},
    )
    with patch("httpx.AsyncClient.post", side_effect=httpx.HTTPStatusError("Unauthorized", request=request, response=response)):
        with patch("app.services.ai_orchestration.get_settings") as mock_settings:
            mock_settings.return_value.llm_api_key = "test-key"
            mock_settings.return_value.llm_base_url = "https://api.openai.com/v1"
            mock_settings.return_value.llm_model = "test-model"
            mock_settings.return_value.llm_timeout_seconds = 5
            with pytest.raises(AIProviderError) as exc_info:
                await ai_orchestrator.complete([{"role": "user", "content": "hi"}], operation="test")
            assert "AI provider error (401): Invalid API Key" in str(exc_info.value)


def test_settings_production_validation() -> None:
    from app.configs.config import Settings

    # In development, missing jwt_secret automatically uses a safe dev fallback
    dev_settings = Settings(environment="development", jwt_secret="")
    assert dev_settings.jwt_secret == "dev-insecure-jwt-secret-for-local-development-only"
    assert dev_settings.minio_access_key == "groundwork"

    # In production, missing or default jwt_secret raises a ValueError
    with pytest.raises(ValueError, match="JWT_SECRET must be set"):
        Settings(environment="production", jwt_secret="")

    with pytest.raises(ValueError, match="JWT_SECRET must be set"):
        Settings(environment="production", jwt_secret="change-me-in-production")

    prod_settings = Settings(environment="production", jwt_secret="super-secure-production-random-secret-key-12345")
    assert prod_settings.jwt_secret == "super-secure-production-random-secret-key-12345"
