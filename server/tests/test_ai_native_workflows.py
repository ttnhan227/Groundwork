import uuid

import pytest
from pydantic import ValidationError

from app.models import (
    ArtifactVersion,
    ConversationResource,
    PlannerRun,
    ToolExecution,
    WorkflowEvent,
    WorkflowRun,
    WorkflowStepRun,
    WorkspaceMemory,
)
from app.schemas import ConversationCommandRequest
from app.workflows import build_plan, build_plan_for_documents


def test_conversation_command_requires_a_source_and_idempotency_id() -> None:
    document_id = uuid.uuid4()
    message_id = uuid.uuid4()
    command = ConversationCommandRequest(
        client_message_id=message_id,
        command="Compress this document",
        document_ids=[document_id],
    )

    assert command.client_message_id == message_id
    assert command.document_ids == [document_id]
    with pytest.raises(ValidationError):
        ConversationCommandRequest(
            client_message_id=message_id,
            command="Compress this document",
            document_ids=[],
        )


def test_planner_marks_destructive_steps_for_confirmation() -> None:
    steps = build_plan("Remove page 7 and compress it strongly", uuid.uuid4())

    assert [step.tool for step in steps] == ["delete_pages", "compress_pdf"]
    assert steps[0].confirmation_required is True
    assert steps[0].parameters["page_numbers"] == [7]
    assert steps[1].parameters["preset"] == "strong"


def test_ai_native_persistence_models_have_expected_tables() -> None:
    assert ArtifactVersion.__tablename__ == "artifact_versions"
    assert PlannerRun.__tablename__ == "planner_runs"
    assert WorkflowRun.__tablename__ == "workflow_runs"
    assert WorkflowStepRun.__tablename__ == "workflow_step_runs"
    assert ToolExecution.__tablename__ == "tool_executions"
    assert ConversationResource.__tablename__ == "conversation_resources"
    assert WorkflowEvent.__tablename__ == "workflow_events"
    assert WorkspaceMemory.__tablename__ == "workspace_memories"


def test_multi_document_planner_maps_comparison_and_merge() -> None:
    left, right = uuid.uuid4(), uuid.uuid4()

    comparison = build_plan_for_documents("Compare these contracts", [left, right])
    merge = build_plan_for_documents("Merge these PDFs", [left, right])

    assert comparison[0].tool == "comparison"
    assert comparison[0].parameters["left_document_id"] == str(left)
    assert merge[0].tool == "merge"
    assert merge[0].parameters["document_ids"] == [str(left), str(right)]


def test_planner_maps_ai_capabilities() -> None:
    document_id = uuid.uuid4()

    assert build_plan_for_documents("Create a quiz", [document_id])[0].tool == "quiz"
    assert build_plan_for_documents("Translate into Vietnamese", [document_id])[0].tool == "translation"
    assert build_plan_for_documents("Extract information", [document_id])[0].tool == "extraction"
