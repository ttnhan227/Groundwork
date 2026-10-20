"""Audit hardening and regression test suite covering:
1. Correct and incorrect retrieval matches.
2. Missing context and unanswerable questions.
3. Citation verification and invalid source references.
4. Duplicate ingestion and document updates.
5. Cross-workspace access isolation.
6. Background assistant job cancellation, recovery, and failures.
7. External AI provider timeouts and malformed responses.
"""

from __future__ import annotations

import tempfile
import time
from pathlib import Path

import httpx
import pytest

from app.core import config
from app.database.local_db import get_db, reset_db
from app.models.types import (
    AIQueryRequest,
    CitationItem,
    WorkspaceCreate,
)
from app.services.ai.citation_verifier import CitationVerifier
from app.services.ai.context_engine import AIContextEngine
from app.services.ai.providers import GeminiProvider, OllamaProvider, OpenAIProvider
from app.services.assistant_jobs import AssistantJobs
from app.services.indexer_service import IndexerService
from app.services.search_engine import SearchEngine
from app.services.workspace_service import WorkspaceService


@pytest.fixture
def audit_environment():
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir).resolve()
        db_path = root / "test_audit.db"
        config._settings = config.Settings(database_path=db_path, data_dir=root)
        reset_db()
        yield root
        reset_db()


# ─── 1. Retrieval Matches: Correct and Incorrect ─────────────────────────────

def test_retrieval_correct_and_incorrect_matches(audit_environment):
    root = audit_environment
    ws_dir = root / "ws1"
    ws_dir.mkdir()
    doc = ws_dir / "payment_gateway.py"
    doc.write_text("""
def process_stripe_webhook(payload: dict) -> bool:
    \"\"\"Process incoming Stripe webhook for subscription lifecycle.\"\"\"
    event_type = payload.get("type")
    if event_type == "invoice.payment_succeeded":
        return True
    return False
""")

    ws_svc = WorkspaceService()
    ws = ws_svc.create_workspace(WorkspaceCreate(name="WS1", path=str(ws_dir)))

    indexer = IndexerService.get_instance()
    indexer.index_single_file(doc, ws.id)

    searcher = SearchEngine()

    # Correct match: query terms present in file
    res_correct = searcher.search("stripe webhook invoice payment", mode="hybrid")
    assert res_correct.total_matches >= 1
    assert res_correct.results[0].filename == "payment_gateway.py"
    assert res_correct.results[0].score > 0
    assert "stripe" in res_correct.results[0].snippet.lower() or "webhook" in res_correct.results[0].snippet.lower()

    # Incorrect match: nonsense query should return 0 matches
    res_incorrect = searcher.search("quantum_flux_capacitor_xyz999", mode="hybrid")
    assert res_incorrect.total_matches == 0
    assert len(res_incorrect.results) == 0


# ─── 2. Missing Context and Unanswerable Questions ───────────────────────────

def test_missing_context_and_unanswerable_questions(audit_environment):
    root = audit_environment
    ws_dir = root / "ws1"
    ws_dir.mkdir()
    doc = ws_dir / "user_guide.txt"
    doc.write_text("This application allows users to organize files into virtual collections.")

    ws_svc = WorkspaceService()
    ws = ws_svc.create_workspace(WorkspaceCreate(name="WS1", path=str(ws_dir)))
    IndexerService.get_instance().index_single_file(doc, ws.id)

    engine = AIContextEngine()

    # Case A: Question with no selected files and search_workspace finding nothing relevant
    req_no_match = AIQueryRequest(
        question="What is the cryptographic AES private key for database backups?",
        search_workspace=True,
        provider="local",
    )
    resp_no_match = engine.query(req_no_match)
    assert resp_no_match.evidence_count == 0
    assert "No relevant indexed files were found" in resp_no_match.answer

    # Case B: File is selected, but question asks about completely unrelated, unmentioned facts
    req_unrelated = AIQueryRequest(
        question="What is the CEO's annual salary and bonus package?",
        file_paths=[str(doc)],
        provider="local",
    )
    resp_unrelated = engine.query(req_unrelated)
    # Local mode truthfully presents only the actual excerpt without inventing an answer
    assert resp_unrelated.evidence_count == 1
    assert "virtual collections" in resp_unrelated.citations[0].snippet
    assert "Local mode shows excerpts and does not generate an answer" in resp_unrelated.answer


# ─── 3. Citation Verification and Invalid Sources ────────────────────────────

def test_citation_verification_valid_and_invalid():
    retrieved = [
        CitationItem(
            path="/workspace/auth.py",
            filename="auth.py",
            line_start=10,
            line_end=40,
            snippet="def authenticate_user(): pass",
        ),
        CitationItem(
            path="/workspace/billing.py",
            filename="billing.py",
            line_start=1,
            line_end=25,
            snippet="def create_invoice(): pass",
        ),
    ]

    # Valid citations within retrieved bounds
    valid_answer = (
        "User credentials are authenticated in [source: auth.py:15]. "
        "Invoices are created in [source: billing.py:10]."
    )
    report_valid = CitationVerifier.verify(valid_answer, retrieved)
    assert report_valid.total_citations == 2
    assert report_valid.valid_citations == 2
    assert report_valid.invalid_citations == 0
    assert report_valid.citation_precision == 1.0
    assert report_valid.grounded is True
    assert report_valid.unsupported_claims_warning is False

    # Hallucinated source not in retrieved documents
    hallucinated_answer = (
        "Passwords are decrypted using [source: secret_vault.py:50] and auth [source: auth.py:20]."
    )
    report_hallucinated = CitationVerifier.verify(hallucinated_answer, retrieved)
    assert report_hallucinated.total_citations == 2
    assert report_hallucinated.valid_citations == 1
    assert report_hallucinated.invalid_citations == 1
    assert report_hallucinated.citation_precision == 0.5
    assert report_hallucinated.grounded is False
    assert report_hallucinated.unsupported_claims_warning is True
    assert any("secret_vault.py" in ref["filename"] and not ref["is_valid_source"] for ref in report_hallucinated.references)

    # Out-of-bounds line number
    out_of_bounds_answer = "Authentication occurs at [source: auth.py:9999]."
    report_oob = CitationVerifier.verify(out_of_bounds_answer, retrieved)
    assert report_oob.valid_citations == 0
    assert report_oob.invalid_citations == 1
    assert report_oob.grounded is False
    assert any("outside retrieved bounds" in ref["reason"] for ref in report_oob.references)

    # Safe refusal response (acknowledges missing evidence)
    safe_answer = "No matching workspace evidence was found for this query."
    report_safe = CitationVerifier.verify(safe_answer, [])
    assert report_safe.grounded is True
    assert report_safe.unsupported_claims_warning is False


# ─── 4. Duplicate Ingestion and Document Updates ─────────────────────────────

def test_duplicate_ingestion_and_document_updates(audit_environment):
    root = audit_environment
    ws_dir = root / "ws1"
    ws_dir.mkdir()
    doc = ws_dir / "data.py"
    doc.write_text("INITIAL_VALUE = 42\n")

    ws_svc = WorkspaceService()
    ws = ws_svc.create_workspace(WorkspaceCreate(name="WS1", path=str(ws_dir)))

    indexer = IndexerService.get_instance()

    # Step 1: Initial indexing
    indexed_1 = indexer.index_single_file(doc, ws.id)
    assert indexed_1 is True

    conn = get_db().get_connection()
    row1 = conn.execute("SELECT id, hash FROM files WHERE path = ?", (str(doc),)).fetchone()
    assert row1 is not None
    initial_hash = row1["hash"]
    chunk_count_1 = conn.execute("SELECT count(*) FROM chunks WHERE file_id = ?", (row1["id"],)).fetchone()[0]
    assert chunk_count_1 >= 1

    # Step 2: Duplicate ingestion of unchanged file
    indexed_2 = indexer.index_single_file(doc, ws.id)
    assert indexed_2 is False  # Skipped because hash and content are identical
    row2 = conn.execute("SELECT hash FROM files WHERE path = ?", (str(doc),)).fetchone()
    assert row2["hash"] == initial_hash

    # Step 3: Modify document content
    time.sleep(0.01)  # Ensure mtime advance if needed
    doc.write_text("UPDATED_VALUE = 999\nNEW_FUNCTION = True\n")
    indexed_3 = indexer.index_single_file(doc, ws.id)
    assert indexed_3 is True  # Re-indexed because content changed

    row3 = conn.execute("SELECT hash FROM files WHERE path = ?", (str(doc),)).fetchone()
    assert row3["hash"] != initial_hash

    # Verify FTS and chunks were refreshed
    searcher = SearchEngine()
    res_old = searcher.search("INITIAL_VALUE", mode="lexical")
    assert res_old.total_matches == 0  # Old content removed from FTS

    res_new = searcher.search("UPDATED_VALUE", mode="lexical")
    assert res_new.total_matches >= 1  # New content present in FTS


# ─── 5. Cross-Workspace Access Attempts ──────────────────────────────────────

def test_cross_workspace_access_denied(audit_environment):
    root = audit_environment
    ws1_dir = root / "workspace_alpha"
    ws2_dir = root / "workspace_beta"
    ws1_dir.mkdir()
    ws2_dir.mkdir()

    file_alpha = ws1_dir / "alpha_notes.txt"
    file_alpha.write_text("Alpha Project confidential roadmap.")

    file_beta = ws2_dir / "beta_secrets.txt"
    file_beta.write_text("Beta Project confidential financial data.")

    ws_svc = WorkspaceService()
    ws_alpha = ws_svc.create_workspace(WorkspaceCreate(name="Alpha", path=str(ws1_dir)))
    ws_beta = ws_svc.create_workspace(WorkspaceCreate(name="Beta", path=str(ws2_dir)))

    indexer = IndexerService.get_instance()
    indexer.index_single_file(file_alpha, ws_alpha.id)
    indexer.index_single_file(file_beta, ws_beta.id)

    engine = AIContextEngine()

    # Query targeting Workspace Alpha with a file from Workspace Beta
    cross_ws_req = AIQueryRequest(
        question="Summarize beta financial data",
        workspace_id=ws_alpha.id,
        file_paths=[str(file_beta)],
        provider="local",
    )
    with pytest.raises(ValueError, match="Cross-workspace access denied"):
        engine.query(cross_ws_req)

    # Inactive workspace isolation in search
    conn = get_db().get_connection()
    conn.execute("UPDATE workspaces SET is_active = 0 WHERE id = ?", (ws_beta.id,))
    conn.commit()

    searcher = SearchEngine()
    # Search without workspace_id should only return active workspace files
    res_all = searcher.search("confidential", mode="hybrid")
    paths = [r.path for r in res_all.results]
    assert str(file_alpha) in paths
    assert str(file_beta) not in paths  # Beta is inactive, must NOT be returned!


# ─── 6. Background Assistant Jobs Cancellation & Recovery ────────────────────

def test_background_assistant_jobs_cancellation_and_recovery():
    import threading

    block_event = threading.Event()
    unblock_event = threading.Event()

    def slow_worker():
        block_event.set()
        # Wait until test signals or timeout
        unblock_event.wait(timeout=5.0)
        return {"status": "finished"}

    # Start slow job
    job = AssistantJobs.start(slow_worker)
    job_id = job["id"]
    block_event.wait(timeout=2.0)

    # Attempting to start another job while one is running raises ValueError
    with pytest.raises(ValueError, match="Another assistant task is running"):
        AssistantJobs.start(lambda: {"status": "fast"})

    # Cancel the running job
    cancelled_job = AssistantJobs.cancel(job_id)
    assert cancelled_job["status"] == "cancelled"
    assert "cancelled" in cancelled_job["error"].lower()

    # Unblock the background thread
    unblock_event.set()

    # Now that the job is cancelled, a new job can start immediately
    new_job = AssistantJobs.start(lambda: {"result": "success"})
    time.sleep(0.1)
    status = AssistantJobs.get(new_job["id"])
    assert status["status"] == "complete"
    assert status["result"] == {"result": "success"}

    # Terminal failure handling in worker
    def failing_worker():
        raise RuntimeError("Fatal database connection loss")

    failed_job = AssistantJobs.start(failing_worker)
    time.sleep(0.1)
    failed_status = AssistantJobs.get(failed_job["id"])
    assert failed_status["status"] == "error"
    assert "Fatal database connection loss" in failed_status["error"]


# ─── 7. External AI Provider Timeouts and Malformed Responses ────────────────

def test_provider_timeouts_and_rate_limits(monkeypatch):
    # Test TimeoutException handling
    def mock_timeout_transport(request):
        raise httpx.TimeoutException("Read timeout after 45 seconds", request=request)

    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: httpx.Client(transport=httpx.MockTransport(mock_timeout_transport)),
    )

    openai_prov = OpenAIProvider(api_key="test-key")
    with pytest.raises(RuntimeError, match="could not complete"):
        openai_prov.generate("Test prompt")

    gemini_prov = GeminiProvider(api_key="test-key")
    with pytest.raises(RuntimeError, match="could not complete"):
        gemini_prov.generate("Test prompt")

    ollama_prov = OllamaProvider()
    with pytest.raises(RuntimeError, match="could not complete"):
        ollama_prov.generate("Test prompt")


def test_provider_malformed_json_responses(monkeypatch):
    # Test unexpected or truncated JSON responses
    malformed_payloads = [
        {},  # Completely empty dictionary
        {"choices": []},  # Empty choices array
        {"choices": [{"message": {}}]},  # Missing content key
        {"candidates": [{}]},  # Empty candidate
    ]

    for payload in malformed_payloads:
        monkeypatch.setattr(
            httpx,
            "Client",
            lambda **kwargs: httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, json=payload))),
        )
        with pytest.raises(RuntimeError, match="could not complete"):
            OpenAIProvider(api_key="test-key").generate("Test prompt")


# ─── 8. Path Validation & API HTTP Status Code Semantics ─────────────────────

def test_validate_workspace_path_rejects_empty():
    from app.core.security import validate_workspace_path
    with pytest.raises(ValueError, match="Path cannot be empty"):
        validate_workspace_path("", ["/some/workspace"])

    with pytest.raises(ValueError, match="Path cannot be empty"):
        validate_workspace_path("   ", ["/some/workspace"])


def test_api_error_status_codes_on_client_errors(audit_environment):
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    root = audit_environment
    ws1 = root / "ws1"
    ws2 = root / "ws2"
    ws1.mkdir()
    ws2.mkdir()
    f2 = ws2 / "secret.txt"
    f2.write_text("secret")

    ws_svc = WorkspaceService()
    ws1_obj = ws_svc.create_workspace(WorkspaceCreate(name="WS1", path=str(ws1)))

    # Cross-workspace access via API should return 400 Bad Request, NOT 500 Internal Server Error
    response = client.post(
        "/api/ai/query",
        json={
            "question": "Read secret",
            "workspace_id": ws1_obj.id,
            "file_paths": [str(f2)],
            "provider": "local",
        },
    )
    assert response.status_code == 400
    assert "Cross-workspace access denied" in response.json()["detail"]

    # Invalid tool argument should return 400 Bad Request, NOT 500
    tool_resp = client.post(
        "/api/ai/tools/execute",
        json={
            "tool_name": "read_file",
            "arguments": {"invalid_arg": 123},
        },
    )
    assert tool_resp.status_code == 400 or (tool_resp.status_code == 200 and tool_resp.json().get("status") == "blocked")

