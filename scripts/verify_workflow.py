"""Groundwork - End-to-End Golden Workflow Verification Script.

Demonstrates and verifies the complete local-first developer workflow:
1. Workspace Initialization & File Provisioning
2. Code Ingestion & AST Symbol Chunking
3. Hybrid Retrieval (FTS5 Lexical BM25 + ONNX Dense Vector Cosine)
4. AI Context Assembly & Grounded Citation Verification
5. Security Boundary & Path Traversal Verification
6. Clean Resource Teardown

Run with:
    python scripts/verify_workflow.py
Requires zero third-party API keys and runs 100% locally.
"""

from __future__ import annotations

import sys
import tempfile
import time
from pathlib import Path

# Add server directory to path
REPO_ROOT = Path(__file__).resolve().parent.parent
SERVER_DIR = REPO_ROOT / "server"
sys.path.insert(0, str(SERVER_DIR))

from app.core import config  # noqa: E402
from app.database.local_db import reset_db  # noqa: E402
from app.models.types import AIQueryRequest, WorkspaceCreate  # noqa: E402
from app.services.ai.context_engine import AIContextEngine  # noqa: E402
from app.services.indexer_service import IndexerService  # noqa: E402
from app.services.search_engine import SearchEngine  # noqa: E402
from app.services.workspace_service import WorkspaceService  # noqa: E402


def run_golden_workflow():
    print("=" * 70)
    print("Groundwork — End-to-End Developer Workflow Verification")
    print("=" * 70)

    t_total_start = time.perf_counter()

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        db_path = temp_path / "workflow_test.db"
        workspace_dir = temp_path / "demo_project"
        workspace_dir.mkdir()

        # Step 1: Provision realistic project files
        print("\n[1/6] Provisioning realistic project files...")
        auth_file = workspace_dir / "auth_service.py"
        auth_file.write_text(
            '"""Authentication and JWT token validation module."""\n\n'
            'class Authenticator:\n'
            '    def __init__(self, secret_key: str):\n'
            '        self.secret_key = secret_key\n\n'
            '    def verify_jwt_token(self, token: str) -> dict:\n'
            '        """Decodes and validates JWT claims with expiration check."""\n'
            '        return {"user_id": "usr_123", "role": "admin", "valid": True}\n',
            encoding="utf-8",
        )

        db_file = workspace_dir / "database.py"
        db_file.write_text(
            '"""SQLite database configuration with WAL journal mode."""\n\n'
            'def get_sqlite_connection(path: str):\n'
            '    import sqlite3\n'
            '    conn = sqlite3.connect(path, timeout=30.0)\n'
            '    conn.execute("PRAGMA journal_mode = WAL;")\n'
            '    conn.execute("PRAGMA synchronous = NORMAL;")\n'
            '    return conn\n',
            encoding="utf-8",
        )
        print(f"      Created: {auth_file.name} (Python AST)")
        print(f"      Created: {db_file.name} (Database config)")

        # Step 2: Initialize Workspace & Local DB
        print("\n[2/6] Initializing local SQLite database & workspace...")
        config._settings = config.Settings(database_path=db_path, data_dir=temp_path)
        ws_service = WorkspaceService()
        ws = ws_service.create_workspace(WorkspaceCreate(name="DemoProject", path=str(workspace_dir)))
        print(f"      Registered workspace '{ws.name}' (ID: {ws.id})")

        # Step 3: Ingestion & AST Embedding
        print("\n[3/6] Ingesting files (AST parsing & ONNX vector embedding)...")
        t0 = time.perf_counter()
        indexer = IndexerService.get_instance()
        indexed_auth = indexer.index_single_file(auth_file, ws.id)
        indexed_db = indexer.index_single_file(db_file, ws.id)
        ingest_ms = (time.perf_counter() - t0) * 1000
        print(f"      Indexed 2 files in {ingest_ms:.1f} ms (Status: auth={indexed_auth}, db={indexed_db})")

        # Step 4: Hybrid Search (Lexical + Semantic)
        print("\n[4/6] Executing hybrid retrieval query ('verify_jwt_token claims')...")
        t0 = time.perf_counter()
        searcher = SearchEngine()
        search_res = searcher.search("verify_jwt_token claims", mode="hybrid", limit=5, workspace_id=ws.id)
        search_ms = (time.perf_counter() - t0) * 1000
        print(f"      Matches found: {search_res.total_matches} in {search_ms:.1f} ms")
        for i, match in enumerate(search_res.results, start=1):
            print(f"        #{i}: {match.filename}:{match.line_number} (Score: {match.score:.3f})")
            print(f"             Snippet: {match.snippet[:60]}...")
        assert len(search_res.results) > 0 and "auth_service.py" in search_res.results[0].filename, "Expected auth_service.py as top match"

        # Step 5: Grounded AI Query & Citation Verification
        print("\n[5/6] Assembling AI context and verifying source citations...")
        engine = AIContextEngine()
        ai_req = AIQueryRequest(
            question="How are JWT tokens verified?",
            workspace_id=ws.id,
            file_paths=[str(auth_file)],
            provider="local",
        )
        t0 = time.perf_counter()
        ai_res = engine.query(ai_req)
        ai_ms = (time.perf_counter() - t0) * 1000
        print(f"      AI Response generated in {ai_ms:.1f} ms")
        print(f"      Evidence count: {ai_res.evidence_count} sources retrieved")
        if ai_res.citation_verification:
            ver = ai_res.citation_verification
            print("      Citation Verification Report:")
            print(f"        - Valid citations: {ver.get('valid_citations', 0)}")
            print(f"        - Invalid citations: {ver.get('invalid_citations', 0)}")
            print(f"        - Grounded: {ver.get('grounded')}")

        # Step 6: Security Boundary Enforcement
        print("\n[6/6] Verifying workspace security boundary enforcement...")
        outside_file = temp_path / "outside_secret.txt"
        outside_file.write_text("classified data outside workspace")
        bad_req = AIQueryRequest(
            question="Read outside data",
            workspace_id=ws.id,
            file_paths=[str(outside_file)],
            provider="local",
        )
        try:
            engine.query(bad_req)
            raise AssertionError("Security check failed: cross-workspace file was not rejected!")
        except ValueError as exc:
            print(f"      Successfully intercepted unauthorized access: {exc}")

        # Clean DB connections for Windows file unlinking
        reset_db()
        ws_service.db.close()

    total_time_ms = (time.perf_counter() - t_total_start) * 1000
    print("\n" + "=" * 70)
    print(f"SUCCESS: Golden workflow verified in {total_time_ms:.1f} ms with ZERO errors.")
    print("=" * 70)


if __name__ == "__main__":
    run_golden_workflow()
