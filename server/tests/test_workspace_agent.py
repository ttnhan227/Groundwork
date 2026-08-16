import uuid

from app.workspace_agent import WorkspaceAgentRequest, _classify_intent, _content_to_blocks, _sse_event


def test_classify_intent_identifies_artifact_generation() -> None:
    assert _classify_intent("Create a verified technical proposal from these sources", None) == "generate_artifact"
    assert _classify_intent("Draft a client report based on the brief", None) == "generate_artifact"
    assert _classify_intent("What is in this document?", "report") == "generate_artifact"
    assert _classify_intent("What is in this document?", "presentation") == "generate_artifact"


def test_classify_intent_identifies_verification() -> None:
    assert _classify_intent("Check this proposal for unsupported claims", None) == "verify_artifact"
    assert _classify_intent("Verify requirement coverage", None) == "verify_artifact"
    assert _classify_intent("Audit claims against sources", "verify") == "verify_artifact"


def test_classify_intent_identifies_modification() -> None:
    assert _classify_intent("Make section 2 shorter", None) == "modify_artifact"
    assert _classify_intent("Rewrite section 3 with more details", None) == "modify_artifact"


def test_classify_intent_identifies_notes() -> None:
    assert _classify_intent("note: Follow up with team on Monday", None) == "create_note"
    assert _classify_intent("save note: Pricing structure confirmed", None) == "create_note"


def test_classify_intent_defaults_to_grounded_qa() -> None:
    assert _classify_intent("What does the contract say about termination?", None) == "grounded_qa"
    assert _classify_intent("Summarize section 1", None) == "grounded_qa"


def test_content_to_blocks_converts_markdown() -> None:
    markdown = "# Executive Summary\n\nThis is a paragraph.\n\n- Bullet item 1\n- Bullet item 2"
    blocks = _content_to_blocks(markdown)

    assert len(blocks) == 4
    assert blocks[0] == {"type": "heading", "text": "Executive Summary"}
    assert blocks[1] == {"type": "paragraph", "text": "This is a paragraph."}
    assert blocks[2] == {"type": "bullet", "text": "Bullet item 1"}
    assert blocks[3] == {"type": "bullet", "text": "Bullet item 2"}


def test_sse_event_formatting() -> None:
    event_str = _sse_event("status", {"step": "analyzing_sources", "label": "Analyzing..."})
    assert event_str.startswith("event: status\n")
    assert '"step": "analyzing_sources"' in event_str
    assert event_str.endswith("\n\n")


def test_workspace_agent_request_validation() -> None:
    req = WorkspaceAgentRequest(
        workspace_id=uuid.uuid4(),
        prompt="Create a technical proposal",
        source_document_ids=[uuid.uuid4()],
        action_type="proposal",
    )
    assert req.prompt == "Create a technical proposal"
    assert req.action_type == "proposal"
