import uuid
import json

from app.chat import _sse
from app.models import Collection, Document
from app.schemas import CollectionCreate, DocumentMetadataUpdate, DocumentResponse


def test_document_metadata_normalizes_and_deduplicates_tags() -> None:
    payload = DocumentMetadataUpdate(
        display_title="Quarterly Review",
        tags=[" Finance ", "finance", "Deadline", ""],
        collection_id=uuid.uuid4(),
    )
    assert payload.tags == ["finance", "deadline"]


def test_collection_schema_validates_color() -> None:
    payload = CollectionCreate(name="Contracts", color="#3154d8")
    assert payload.name == "Contracts"
    assert payload.color == "#3154d8"


def test_version_two_five_models_expose_workspace_fields() -> None:
    assert hasattr(Document, "display_title")
    assert hasattr(Document, "tags")
    assert hasattr(Document, "collection_id")
    assert hasattr(Collection, "owner_id")


def test_document_response_keeps_metadata_backward_compatible() -> None:
    response = DocumentResponse.model_validate({
        "id": uuid.uuid4(),
        "filename": "source.pdf",
        "content_type": "application/pdf",
        "size_bytes": 10,
        "status": "ready",
        "page_count": 1,
        "error_message": None,
        "created_at": "2026-07-28T00:00:00Z",
    })
    assert response.display_title is None
    assert response.tags == []
    assert response.collection_id is None


def test_chat_stream_events_are_valid_sse_json() -> None:
    frame = _sse("token", {"text": "hello\nworld"})
    lines = frame.strip().splitlines()
    assert lines[0] == "event: token"
    assert json.loads(lines[1].removeprefix("data: ")) == {"text": "hello\nworld"}
