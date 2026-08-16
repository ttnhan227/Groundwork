from app.main import app
from app.schemas import (
    NativeDocumentBlocksRequest,
    WorkspaceCreateRequest,
    WorkspaceMemoryCreate,
)


def test_dual_routes_registered_in_fastapi() -> None:
    routes = {route.path for route in app.routes if hasattr(route, "path")}

    # Conversations
    assert "/api/v1/conversations/{conversation_id}" in routes

    # Workspace CRUD
    assert "/api/v1/workspaces" in routes
    assert "/api/v1/workspaces/{workspace_id}" in routes

    # Dual-routed native documents & sub-resources
    assert "/api/v1/native-documents/{native_id}" in routes
    assert "/api/v1/workspaces/{workspace_id}/native-documents/{native_id}" in routes

    assert "/api/v1/native-documents/{native_id}/blocks" in routes
    assert "/api/v1/workspaces/{workspace_id}/native-documents/{native_id}/blocks" in routes

    assert "/api/v1/native-documents/{native_id}/review-findings" in routes
    assert "/api/v1/workspaces/{workspace_id}/native-documents/{native_id}/review-findings" in routes

    assert "/api/v1/native-documents/{native_id}/readiness" in routes
    assert "/api/v1/workspaces/{workspace_id}/native-documents/{native_id}/readiness" in routes

    assert "/api/v1/native-documents/{native_id}/versions" in routes
    assert "/api/v1/workspaces/{workspace_id}/native-documents/{native_id}/versions" in routes

    assert "/api/v1/native-documents/{native_id}/comments" in routes
    assert "/api/v1/workspaces/{workspace_id}/native-documents/{native_id}/comments" in routes

    assert "/api/v1/native-documents/{native_id}/suggestions" in routes
    assert "/api/v1/workspaces/{workspace_id}/native-documents/{native_id}/suggestions" in routes

    assert "/api/v1/native-documents/{native_id}/requirements" in routes
    assert "/api/v1/workspaces/{workspace_id}/native-documents/{native_id}/requirements" in routes

    assert "/api/v1/native-documents/{native_id}/requirements/extract" in routes
    assert "/api/v1/workspaces/{workspace_id}/native-documents/{native_id}/requirements/extract" in routes

    assert "/api/v1/native-documents/{native_id}/export" in routes
    assert "/api/v1/workspaces/{workspace_id}/native-documents/{native_id}/export" in routes

    # Workspace memories
    assert "/api/v1/workspaces/{workspace_id}/memories" in routes
    assert "/api/v1/workspaces/{workspace_id}/memories/{memory_id}" in routes


def test_schema_instantiations() -> None:
    ws_req = WorkspaceCreateRequest(name="My Project Notebook", kind="personal")
    assert ws_req.name == "My Project Notebook"
    assert ws_req.kind == "personal"

    blocks_req = NativeDocumentBlocksRequest(blocks=[
        {"type": "heading", "text": "Overview"},
        {"type": "paragraph", "text": "Details here"},
    ])
    assert len(blocks_req.blocks) == 2

    mem_req = WorkspaceMemoryCreate(key="note", value="Remember to verify claims")
    assert mem_req.key == "note"
    assert mem_req.value == "Remember to verify claims"
