import uuid
import pytest

from app.models.note import Note
from app.dtos.note_dto import NoteCreateRequest, NoteUpdateRequest, NoteResponse
from app.services.rag import format_grounded_answer
from app.controllers.workspace_agent import extract_grounded_citations


def test_note_model_attributes_and_defaults():
    ws_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    note = Note(
        workspace_id=ws_id,
        owner_id=owner_id,
        title="Research Finding",
        content="Key finding from Q3 report",
        note_type="saved_answer",
        citations=[{"document_id": str(uuid.uuid4()), "document_name": "q3.pdf", "page_number": 3}],
    )
    assert note.title == "Research Finding"
    assert note.content == "Key finding from Q3 report"
    assert note.note_type == "saved_answer"
    assert note.workspace_id == ws_id
    assert note.owner_id == owner_id
    assert len(note.citations) == 1
    assert note.citations[0]["page_number"] == 3


def test_note_dto_validation_and_serialization():
    # Valid creation
    create_dto = NoteCreateRequest(
        title="Personal note",
        content="Remember to check contract clause 5.2",
        note_type="user",
    )
    assert create_dto.title == "Personal note"
    assert create_dto.note_type == "user"

    # Default note_type
    default_dto = NoteCreateRequest(
        title="Default note",
        content="Default content",
    )
    assert default_dto.note_type == "user"

    # Update DTO
    update_dto = NoteUpdateRequest(title="Updated title")
    assert update_dto.title == "Updated title"
    assert update_dto.content is None

    # Response validation
    note_id = uuid.uuid4()
    ws_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    response_dto = NoteResponse.model_validate(
        {
            "id": note_id,
            "workspace_id": ws_id,
            "owner_id": owner_id,
            "title": "Title",
            "content": "Content",
            "note_type": "studio_output",
            "source_id": None,
            "source_title": None,
            "page_number": None,
            "message_id": None,
            "citations": [],
            "created_at": "2026-09-15T00:00:00Z",
            "updated_at": "2026-09-15T00:00:00Z",
        }
    )
    assert response_dto.id == note_id
    assert response_dto.note_type == "studio_output"


def test_grounded_qa_citation_mapping_and_remapping():
    # Model returns references like [Source 1], [Source 3]
    raw_answer = "The system achieved 99.9% uptime [Source 1] under high throughput [Source 3]."
    
    # Mapping old source 1 -> 1, old source 3 -> 2
    mapping = {1: 1, 3: 2}
    formatted = format_grounded_answer(raw_answer, mapping)
    
    assert "[1]" in formatted
    assert "[2]" in formatted
    assert "[Source" not in formatted
    assert formatted == "The system achieved 99.9% uptime [1] under high throughput [2]."


def test_extract_grounded_citations_filters_and_orders():
    # Model answer cites Source 3, then Source 1
    ai_text = "Statement A [Source 3] and Statement B [Source 1] and repeated [Source 3]."

    source_mapping, valid_refs, clean_answer = extract_grounded_citations(ai_text, total_chunks=4)

    # valid_refs should maintain order of first appearance: [3, 1]
    assert valid_refs == [3, 1]
    # source_mapping: Source 3 -> 1, Source 1 -> 2
    assert source_mapping == {3: 1, 1: 2}
    assert "[1]" in clean_answer
    assert "[2]" in clean_answer
    assert "[Source" not in clean_answer


def test_extract_grounded_citations_handles_uncited_answer():
    ai_text = "I do not have enough information to answer."

    source_mapping, valid_refs, clean_answer = extract_grounded_citations(ai_text, total_chunks=2)

    assert valid_refs == []
    assert source_mapping == {}
    assert clean_answer == "I do not have enough information to answer."
