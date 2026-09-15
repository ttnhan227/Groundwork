import uuid
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.dtos.auth_dto import LoginRequest
from app.dtos.document_dto import (
    TextSourceCreateRequest,
    UrlSourceCreateRequest,
    YouTubeSourceCreateRequest,
)
from app.controllers.documents import (
    create_text_source,
    create_url_source,
    create_youtube_source,
    delete_document,
    _ingest_text_source,
)
from app.controllers.workspace import upsert_memory
from app.dtos.workspace_dto import WorkspaceMemoryUpsert
from app.models.document import Document
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMemory


@pytest.mark.asyncio
async def test_create_text_source_verifies_workspace_access():
    ws_id = uuid.uuid4()
    user = User(id=uuid.uuid4(), email="tester@example.com")
    session = AsyncMock()

    payload = TextSourceCreateRequest(
        title="Notes",
        content="Some notes content",
        workspace_id=ws_id,
    )

    with patch("app.controllers.deliverables.workspace_access", new_callable=AsyncMock) as mock_access:
        mock_access.side_effect = HTTPException(status_code=403, detail="Forbidden")
        with pytest.raises(HTTPException) as exc_info:
            await create_text_source(payload, user=user, session=session)
        assert exc_info.value.status_code == 403
        mock_access.assert_awaited_once_with(ws_id, user, session, {"owner", "editor"})


@pytest.mark.asyncio
async def test_create_url_source_verifies_workspace_access_upfront():
    ws_id = uuid.uuid4()
    user = User(id=uuid.uuid4(), email="tester@example.com")
    session = AsyncMock()

    payload = UrlSourceCreateRequest(
        url="https://example.com/article",
        workspace_id=ws_id,
    )

    with patch("app.controllers.deliverables.workspace_access", new_callable=AsyncMock) as mock_access, \
         patch("app.controllers.documents.safe_fetch_url", new_callable=AsyncMock) as mock_fetch:
        mock_access.side_effect = HTTPException(status_code=403, detail="Forbidden")
        with pytest.raises(HTTPException) as exc_info:
            await create_url_source(payload, user=user, session=session)
        assert exc_info.value.status_code == 403
        mock_access.assert_awaited_once_with(ws_id, user, session, {"owner", "editor"})
        mock_fetch.assert_not_called()


@pytest.mark.asyncio
async def test_create_youtube_source_verifies_workspace_access_upfront():
    ws_id = uuid.uuid4()
    user = User(id=uuid.uuid4(), email="tester@example.com")
    session = AsyncMock()

    payload = YouTubeSourceCreateRequest(
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        workspace_id=ws_id,
    )

    with patch("app.controllers.deliverables.workspace_access", new_callable=AsyncMock) as mock_access, \
         patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_http:
        mock_access.side_effect = HTTPException(status_code=403, detail="Forbidden")
        with pytest.raises(HTTPException) as exc_info:
            await create_youtube_source(payload, user=user, session=session)
        assert exc_info.value.status_code == 403
        mock_access.assert_awaited_once_with(ws_id, user, session, {"owner", "editor"})
        mock_http.assert_not_called()


@pytest.mark.asyncio
async def test_ingest_text_source_calculates_page_count():
    user = User(id=uuid.uuid4(), email="tester@example.com")
    workspace = Workspace(id=uuid.uuid4(), name="Personal", owner_id=user.id)
    session = AsyncMock()
    session.add = MagicMock()
    session.scalar.return_value = None  # No duplicate

    with patch("app.controllers.deliverables.ensure_personal_workspace", new_callable=AsyncMock) as mock_ensure, \
         patch("app.controllers.deliverables.activity", new_callable=AsyncMock), \
         patch("app.storage.ObjectStorage") as mock_storage_cls, \
         patch("app.tasks.process_document.delay") as mock_delay:
        mock_ensure.return_value = workspace
        mock_storage = MagicMock()
        mock_storage_cls.return_value = mock_storage
        mock_delay.return_value = MagicMock(id="task-123")

        doc = await _ingest_text_source(
            title="Short Research Text",
            text_content="Page 1 Content\n\nMore Content",
            workspace_id=None,
            user=user,
            session=session,
        )

        assert doc.page_count is not None
        assert doc.page_count >= 1


@pytest.mark.asyncio
async def test_ingest_duplicate_integrity_error_recovery():
    from sqlalchemy.exc import IntegrityError
    user = User(id=uuid.uuid4(), email="tester@example.com")
    workspace = Workspace(id=uuid.uuid4(), name="Personal", owner_id=user.id)
    existing_doc = Document(
        id=uuid.uuid4(),
        owner_id=user.id,
        workspace_id=workspace.id,
        filename="existing.pdf",
        object_key="key/existing.pdf",
        size_bytes=100,
        content_type="application/pdf",
    )
    session = AsyncMock()
    session.add = MagicMock()
    # First scalar check returns None (simulating race condition where check missed concurrent insert)
    # Second scalar check after rollback returns the concurrent duplicate
    session.scalar.side_effect = [None, existing_doc]
    session.commit.side_effect = [IntegrityError("statement", "params", "orig"), None]

    with patch("app.controllers.deliverables.ensure_personal_workspace", new_callable=AsyncMock) as mock_ensure, \
         patch("app.controllers.deliverables.activity", new_callable=AsyncMock), \
         patch("app.storage.ObjectStorage") as mock_storage_cls, \
         patch("app.tasks.process_document.delay") as mock_delay:
        mock_ensure.return_value = workspace
        mock_storage = MagicMock()
        mock_storage_cls.return_value = mock_storage
        mock_delay.return_value = MagicMock(id="task-123")

        doc = await _ingest_text_source(
            title="Concurrent Research Text",
            text_content="Concurrent content",
            workspace_id=None,
            user=user,
            session=session,
        )

        assert doc.id == existing_doc.id
        session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_upsert_memory_explicitly_adds_updated_memory_to_session():
    user = User(id=uuid.uuid4(), email="tester@example.com")
    session = AsyncMock()
    session.add = MagicMock()
    existing_memory = WorkspaceMemory(
        owner_id=user.id,
        workspace_id=uuid.uuid4(),
        key="project_goal",
        value="Initial Goal",
    )
    session.scalar.return_value = existing_memory

    payload = WorkspaceMemoryUpsert(value="Updated Goal")
    result = await upsert_memory(key="project_goal", payload=payload, user=user, session=session)

    assert result.value == "Updated Goal"
    session.add.assert_called_with(existing_memory)
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_document_logs_warning_on_storage_failure():
    user = User(id=uuid.uuid4(), email="tester@example.com")
    session = AsyncMock()
    doc_id = uuid.uuid4()
    doc = Document(
        id=doc_id,
        owner_id=user.id,
        workspace_id=uuid.uuid4(),
        filename="test.pdf",
        object_key="key/test.pdf",
        original_object_key="key/orig/test.txt",
        size_bytes=100,
        content_type="application/pdf",
    )
    session.scalar.return_value = doc

    with patch("app.controllers.documents.ObjectStorage") as mock_storage_cls, \
         patch("app.controllers.documents.logger.warning") as mock_warn:
        mock_storage = MagicMock()
        mock_storage.remove.side_effect = RuntimeError("S3 down")
        mock_storage_cls.return_value = mock_storage

        response = await delete_document(doc_id, user=user, session=session)

        assert response.status_code == 204
        assert mock_warn.call_count == 2
        session.delete.assert_awaited_once_with(doc)
        session.commit.assert_awaited_once()


def test_login_request_rejects_empty_password():
    with pytest.raises(ValidationError):
        LoginRequest(email="valid@example.com", password="")
