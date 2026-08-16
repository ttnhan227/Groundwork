import uuid

import pytest

from app.ai_orchestration import AIProviderError
from app.deliverable_review import extract_requirements, review_deliverable


@pytest.mark.asyncio
async def test_requirement_extraction_normalizes_unknown_kinds(monkeypatch) -> None:
    document_id = uuid.uuid4()
    async def complete_json(*args, **kwargs):
        assert kwargs["operation"] == "deliverable_requirements"
        return {"requirements": [
            {"text": "Include an executive summary", "kind": "section", "is_required": True, "supporting_quote": "Include an executive summary", "document_id": str(document_id), "page_number": 1},
            {"text": "Use the client's logo", "kind": "invented_kind", "is_required": False, "supporting_quote": "Use the client's logo", "document_id": str(document_id), "page_number": 1},
            {"text": "Invent a 30-page appendix", "kind": "format", "is_required": True, "supporting_quote": "not present in source", "document_id": str(document_id), "page_number": 1},
        ]}

    monkeypatch.setattr("app.services.deliverable_review.ai_orchestrator.complete_json", complete_json)
    result = await extract_requirements("Include an executive summary. Use the client's logo. Client brief text")
    assert [item.kind for item in result.requirements] == ["section", "content"]
    assert result.requirements[1].is_required is False
    assert all("appendix" not in item.text for item in result.requirements)


@pytest.mark.asyncio
async def test_review_preserves_source_identity_and_normalizes_findings(monkeypatch) -> None:
    requirement_id = uuid.uuid4()
    document_id = uuid.uuid4()

    async def complete_json(messages, **kwargs):
        assert kwargs["operation"] == "deliverable_review"
        assert str(requirement_id) in messages[1]["content"]
        assert str(document_id) in messages[1]["content"]
        return {
            "coverage": [{
                "requirement_id": str(requirement_id),
                "covered": True,
                "citations": [{"document_id": str(document_id), "document_name": "brief.pdf", "page_number": 2, "snippet": "Target result"}],
            }],
            "findings": [{
                "requirement_id": str(requirement_id),
                "kind": "made_up",
                "severity": "urgent",
                "claim_text": "Revenue doubled",
                "explanation": "The claim is unsupported.",
                "proposed_text": "Revenue increased during the measured period.",
                "citations": [],
            }],
        }

    monkeypatch.setattr("app.services.deliverable_review.ai_orchestrator.complete_json", complete_json)
    result = await review_deliverable(
        "Revenue doubled.",
        [{"id": str(requirement_id), "text": "Explain performance", "is_required": True}],
        f"[document_id={document_id}; document_name=brief.pdf; page=2]\nTarget result",
    )
    assert result.coverage[0].citations[0].document_id == document_id
    assert result.findings[0].kind == "weak_section"
    assert result.findings[0].severity == "medium"


@pytest.mark.asyncio
async def test_review_accepts_nullable_optional_ai_fields(monkeypatch) -> None:
    requirement_id = uuid.uuid4()

    async def complete_json(*args, **kwargs):
        return {
            "coverage": [{"requirement_id": str(requirement_id), "covered": False, "citations": None}],
            "findings": [{
                "requirement_id": str(requirement_id),
                "kind": None,
                "severity": None,
                "claim_text": None,
                "explanation": None,
                "proposed_text": None,
                "citations": None,
            }],
        }

    monkeypatch.setattr("app.services.deliverable_review.ai_orchestrator.complete_json", complete_json)
    result = await review_deliverable(
        "Draft",
        [{"id": str(requirement_id), "text": "Include a summary", "is_required": True}],
        "No linked source pages.",
    )
    assert result.coverage[0].citations == []
    assert result.findings[0].claim_text == ""
    assert result.findings[0].proposed_text == ""
    assert result.findings[0].kind == "weak_section"
    assert result.findings[0].severity == "medium"


@pytest.mark.asyncio
async def test_review_converts_malformed_ai_shape_to_provider_error(monkeypatch) -> None:
    async def complete_json(*args, **kwargs):
        return {"coverage": [{"requirement_id": "not-a-uuid", "covered": True}], "findings": []}

    monkeypatch.setattr("app.services.deliverable_review.ai_orchestrator.complete_json", complete_json)
    with pytest.raises(AIProviderError, match="invalid review result"):
        await review_deliverable("Draft", [], "No linked source pages.")


@pytest.mark.asyncio
async def test_review_enforces_explicit_citations_for_numeric_claims(monkeypatch) -> None:
    document_id = uuid.uuid4()

    async def complete_json(*args, **kwargs):
        return {"coverage": [], "findings": []}

    monkeypatch.setattr("app.services.deliverable_review.ai_orchestrator.complete_json", complete_json)
    result = await review_deliverable(
        "Support tickets represent 31% of first-month questions.",
        [],
        f"[document_id={document_id}; document_name=research.pdf; page=3]\nSupport tickets represent 31% of first-month questions.",
    )

    assert len(result.findings) == 1
    assert result.findings[0].kind == "unsupported_claim"
    assert result.findings[0].claim_type == "number_stat"
    assert result.findings[0].severity == "high"
    assert result.findings[0].citations[0].page_number == 3
    assert "[Source: research.pdf, p. 3]" in result.findings[0].proposed_text


@pytest.mark.asyncio
async def test_review_accepts_numeric_claim_with_inline_source_marker(monkeypatch) -> None:
    async def complete_json(*args, **kwargs):
        return {"coverage": [], "findings": []}

    monkeypatch.setattr("app.services.deliverable_review.ai_orchestrator.complete_json", complete_json)
    result = await review_deliverable(
        "Support tickets represent 31% of questions. [Source: research.pdf, p. 3]",
        [],
        "No linked source pages.",
    )
    assert result.findings == []
