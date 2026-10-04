"""Groundwork Local - Realistic Codebase Search & Retrieval Quality Benchmark.

Measures and compares retrieval quality across:
- Lexical (FTS5) only
- Semantic (Vector Cosine) only
- Universal Hybrid Retrieval

Evaluates against actual Groundwork source files and realistic developer queries.
Metrics calculated:
- Recall@1
- Recall@5
- Mean Reciprocal Rank (MRR)
- Average Query Latency (ms)
"""

from __future__ import annotations

import json
import logging
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Ensure server root is in sys.path
SERVER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_ROOT))

from app.core import config
from app.database.local_db import reset_db
from app.models.types import WorkspaceCreate
from app.services.indexer_service import IndexerService
from app.services.search_engine import SearchEngine
from app.services.workspace_service import WorkspaceService

logging.basicConfig(level=logging.WARNING)

BENCHMARK_CASES = [
    {
        "query": "validate_workspace_path security allowlist",
        "expected_files": ["security.py"],
        "intent": "Find workspace boundary and path sanitization",
    },
    {
        "query": "sqlite connection WAL mode check_same_thread",
        "expected_files": ["local_db.py"],
        "intent": "Find SQLite database configuration and schema",
    },
    {
        "query": "git status log porcelain subprocess",
        "expected_files": ["git_service.py"],
        "intent": "Find Git CLI wrapper and commit inspector",
    },
    {
        "query": "AST parse Python symbols chunk functions",
        "expected_files": ["file_parser.py"],
        "intent": "Find code parser and symbol tree extractor",
    },
    {
        "query": "FTS5 BM25 hybrid ranking score breakdown",
        "expected_files": ["search_engine.py"],
        "intent": "Find hybrid retrieval scoring algorithm",
    },
    {
        "query": "watcher debounce filesystem events watchfiles",
        "expected_files": ["watcher_service.py"],
        "intent": "Find filesystem watcher service",
    },
    {
        "query": "context session save resume working memory",
        "expected_files": ["context_service.py"],
        "intent": "Find working memory session manager",
    },
    {
        "query": "reveal file in windows explorer",
        "expected_files": ["system_service.py"],
        "intent": "Find native OS explorer integration",
    },
    {
        "query": "activity events timeline file_viewed file_modified",
        "expected_files": ["activity_service.py"],
        "intent": "Find activity tracking service",
    },
    {
        "query": "confirmation_token single use authorization token",
        "expected_files": ["security.py", "tools.py"],
        "intent": "Find tool confirmation token security logic",
    },
    {
        "query": "AI context prompt assembly provider",
        "expected_files": ["context_engine.py", "providers.py"],
        "intent": "Find AI context engine and providers",
    },
    {
        "query": "local notes tags markdown sync",
        "expected_files": ["notes_service.py"],
        "intent": "Find local notes management service",
    },
    {
        "query": "batch chunk insertion executemany indexer",
        "expected_files": ["indexer_service.py"],
        "intent": "Find indexer batching and file scanning",
    },
    {
        "query": "fastapi routers search projects health endpoints",
        "expected_files": ["api.py"],
        "intent": "Find local API router endpoints",
    },
    {
        "query": "dense vector embeddings cosine similarity",
        "expected_files": ["embeddings.py", "search_engine.py"],
        "intent": "Dense vector math and similarity scoring",
    },
]


@dataclass
class ModeEvaluationResult:
    mode: str
    recall_at_1: float
    recall_at_5: float
    mrr: float
    avg_latency_ms: float


def run_search_evaluation() -> dict[str, ModeEvaluationResult]:
    app_dir = SERVER_ROOT / "app"
    if not app_dir.exists():
        raise RuntimeError(f"Server app directory not found at {app_dir}")

    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "bench_real.db"
        config._settings = config.Settings(database_path=db_path, data_dir=Path(tmpdir))

        ws_svc = WorkspaceService()
        ws = ws_svc.create_workspace(WorkspaceCreate(name="GroundworkCore", path=str(app_dir)))

        indexer = IndexerService.get_instance()
        # Index actual python source files from server/app
        indexed_count = 0
        for py_file in app_dir.rglob("*.py"):
            if "__pycache__" in str(py_file):
                continue
            if indexer.index_single_file(py_file, ws.id):
                indexed_count += 1

        searcher = SearchEngine()
        modes = ["lexical", "semantic", "hybrid"]
        results: dict[str, ModeEvaluationResult] = {}

        for mode in modes:
            hits_top1 = 0
            hits_top5 = 0
            reciprocal_ranks = []
            latencies = []

            for case in BENCHMARK_CASES:
                query = case["query"]
                expected = case["expected_files"]

                t0 = time.perf_counter()
                res = searcher.search(query, mode=mode, limit=10)
                latencies.append((time.perf_counter() - t0) * 1000)

                top_files = [r.filename for r in res.results]

                # Check top 1
                if top_files and any(top_files[0] == exp for exp in expected):
                    hits_top1 += 1

                # Check top 5
                if any(f in expected for f in top_files[:5]):
                    hits_top5 += 1

                # Compute reciprocal rank
                rr = 0.0
                for rank, f in enumerate(top_files, start=1):
                    if f in expected:
                        rr = 1.0 / rank
                        break
                reciprocal_ranks.append(rr)

            num_cases = len(BENCHMARK_CASES)
            results[mode] = ModeEvaluationResult(
                mode=mode,
                recall_at_1=round(hits_top1 / num_cases * 100, 1),
                recall_at_5=round(hits_top5 / num_cases * 100, 1),
                mrr=round(sum(reciprocal_ranks) / num_cases, 3),
                avg_latency_ms=round(sum(latencies) / len(latencies), 2),
            )

        reset_db()
        return results


def print_evaluation_report(results: dict[str, ModeEvaluationResult]) -> str:
    lines = [
        "# Groundwork Local - Search Quality Benchmark Report",
        "",
        f"Evaluated against {len(BENCHMARK_CASES)} curated developer queries on current Groundwork core source files. This small, repository-specific set is not representative of arbitrary workspaces.",
        "",
        "| Retrieval Mode | Recall @ 1 (%) | Recall @ 5 (%) | MRR (Mean Reciprocal Rank) | Avg Latency (ms) |",
        "| :--- | :---: | :---: | :---: | :---: |",
    ]
    for mode, res in results.items():
        lines.append(
            f"| **{mode.capitalize()}** | {res.recall_at_1}% | {res.recall_at_5}% | {res.mrr} | {res.avg_latency_ms} ms |"
        )

    lines.extend([
        "",
        "### Key Findings:",
        "- **Hybrid Retrieval** achieves balanced retrieval by combining FTS5 lexical matching with vector and recency signals.",
        "- Latencies are measurements from this run, not guarantees. Exact vector scans scale with indexed chunks; no universal latency or recall target is claimed.",
        "- **Real-world Grounding**: Evaluated against live codebase files rather than synthetic text mocks.",
    ])
    return "\n".join(lines)


if __name__ == "__main__":
    res = run_search_evaluation()
    report = print_evaluation_report(res)
    print(report)
    out_file = Path(__file__).resolve().parent / "benchmark_report.md"
    out_file.write_text(report, encoding="utf-8")
    print(f"\nSaved benchmark report to {out_file}")
