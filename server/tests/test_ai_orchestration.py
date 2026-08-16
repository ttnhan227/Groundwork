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
