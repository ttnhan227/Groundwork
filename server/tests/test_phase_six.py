import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.dependencies import admin_user
from app.models import User, UserRole
from app.schemas import DashboardResponse, UserStatsResponse
from app.usage import record_ai_usage


def test_dashboard_schema_exposes_portfolio_metrics() -> None:
    stats = UserStatsResponse(
        document_count=3, page_count=17, storage_bytes=4096,
        ai_requests=8, generated_files=4, failed_jobs=0,
    )
    dashboard = DashboardResponse(**stats.model_dump(), recent_documents=[], recent_jobs=[])
    assert dashboard.page_count == 17
    assert dashboard.generated_files == 4


@pytest.mark.asyncio
async def test_non_admin_is_rejected() -> None:
    user = User(
        id=uuid.uuid4(), email="user@example.com", display_name="User",
        password_hash="hash", role=UserRole.USER, is_active=True,
    )
    with pytest.raises(HTTPException) as error:
        await admin_user(user)
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_ai_daily_limit_rejects_new_paid_request_but_allows_cache_hit() -> None:
    user = User(id=uuid.uuid4(), email="user@example.com", display_name="User", password_hash="hash")
    session = MagicMock()
    session.scalar = AsyncMock(return_value=5)
    with patch("app.usage.get_settings") as settings:
        settings.return_value.ai_daily_request_limit = 5
        with pytest.raises(HTTPException) as error:
            await record_ai_usage(user, "summary", session, cached=False)
        assert error.value.status_code == 429
        await record_ai_usage(user, "summary", session, cached=True)
    session.add.assert_called_once()
