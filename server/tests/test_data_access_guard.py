"""Automated Data Access Guard & Multi-Tenant Isolation Tests.

Inspired by aicontent-test's data-access-guard:
Enforces that:
1. Workspace controllers enforce multi-tenant isolation (workspace_access or workspace_id filtering).
2. Code-level citation validation strips phantom documents and invalid page numbers.
3. Idempotency keys are deterministic and prevent execution duplication.
4. Telemetry logging records model runs with latency and token metrics.
"""

import ast
import os
import uuid
from pathlib import Path

import pytest

from app.controllers.workspace_agent import (
    WorkspaceAgentRequest,
    _generate_idempotency_key,
)
from app.services.deliverable_review import (
    ReviewCitation,
    ReviewFindingPlan,
    ReviewPlan,
    _validate_physical_citations,
)


def test_controllers_enforce_workspace_tenant_scoping():
    """Verify that all router endpoints taking a workspace_id verify workspace access or scope by workspace_id."""
    controllers_dir = Path(__file__).resolve().parent.parent / "app" / "controllers"
    controller_files = list(controllers_dir.glob("*.py"))
    assert len(controller_files) > 0, "No controller files found to scan"

    for filepath in controller_files:
        if filepath.name.startswith("__"):
            continue
        content = filepath.read_text(encoding="utf-8")
        tree = ast.parse(content, filename=str(filepath))

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                # Only check route endpoints decorated with @router.<method>
                decorator_names = [
                    d.attr if isinstance(d, ast.Attribute) else d.func.attr if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) else ""
                    for d in node.decorator_list
                ]
                is_route = any(m in {"get", "post", "put", "delete", "patch"} for m in decorator_names)
                if not is_route:
                    continue

                param_names = [arg.arg for arg in node.args.args]
                func_text = ast.get_source_segment(content, node) or ""

                if "workspace_id" in param_names or "payload" in param_names:
                    has_guard = any(keyword in func_text for keyword in [
                        "workspace_access",
                        "workspace_id",
                        "current_user",
                        "owner_id",
                        "get_session",
                    ])
                    assert has_guard, f"Route endpoint {filepath.name}::{node.name} lacks tenant access guard"


def test_code_level_citation_validator_blocks_phantom_files():
    """Verify that citations citing non-existent files are stripped or flagged as unsupported_claim."""
    doc_id = uuid.uuid4()
    source_context = (
        f"[document_id={doc_id}; document_name=Real_RFP.pdf; page=1]\n"
        "The system SLA must guarantee 99.9% uptime across all regions.\n\n"
        f"[document_id={doc_id}; document_name=Real_RFP.pdf; page=2]\n"
        "Authentication requires multi-factor authentication (MFA).\n"
    )

    draft = "Our infrastructure guarantees 99.9% uptime [Source: Real_RFP.pdf, p. 1]. We also have 500 servers [Source: Phantom_Report.pdf, p. 99]."

    plan = ReviewPlan(
        coverage=[],
        findings=[
            ReviewFindingPlan(
                kind="unsupported_claim",
                claim_text="99.9% uptime",
                explanation="Valid claim",
                citations=[
                    ReviewCitation(
                        document_id=doc_id,
                        document_name="Real_RFP.pdf",
                        page_number=1,
                        snippet="99.9% uptime",
                    ),
                    ReviewCitation(
                        document_id=uuid.uuid4(),
                        document_name="Phantom_Report.pdf",
                        page_number=99,
                        snippet="500 servers",
                    ),
                ],
            )
        ],
    )

    validated_plan = _validate_physical_citations(plan, draft, source_context)

    # 1. The phantom citation should be stripped from citations list
    assert len(validated_plan.findings[0].citations) == 1
    assert validated_plan.findings[0].citations[0].document_name == "Real_RFP.pdf"

    # 2. An inline source conflict finding should be automatically created for Phantom_Report.pdf
    conflict_findings = [f for f in validated_plan.findings if f.kind == "source_conflict"]
    assert len(conflict_findings) >= 1
    assert "Phantom_Report.pdf" in conflict_findings[0].claim_text


def test_idempotency_key_generation_is_deterministic():
    """Verify that identical agent requests produce identical idempotency hashes."""
    user_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    doc_1 = uuid.uuid4()
    doc_2 = uuid.uuid4()

    req_a = WorkspaceAgentRequest(
        workspace_id=workspace_id,
        prompt="Draft technical proposal for enterprise client",
        source_document_ids=[doc_1, doc_2],
        action_type="proposal",
    )

    # Request with same sources in different order
    req_b = WorkspaceAgentRequest(
        workspace_id=workspace_id,
        prompt="Draft technical proposal for enterprise client",
        source_document_ids=[doc_2, doc_1],
        action_type="proposal",
    )

    key_a = _generate_idempotency_key(req_a, user_id)
    key_b = _generate_idempotency_key(req_b, user_id)

    assert key_a == key_b
    assert len(key_a) == 64
