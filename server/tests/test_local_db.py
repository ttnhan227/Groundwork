"""Tests for SQLite database persistence, WAL mode, and FTS5 virtual tables."""

import tempfile
from pathlib import Path

from app.database.local_db import LocalDatabase


def test_database_initialization_and_fts5():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_groundwork.db"
        db = LocalDatabase(db_path)

        conn = db.get_connection()
        # Verify WAL mode
        journal_mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        assert journal_mode.lower() == "wal"

        # Verify tables exist
        tables = [
            r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()
        ]
        assert "workspaces" in tables
        assert "projects" in tables
        assert "files" in tables
        assert "chunks" in tables
        assert "fts_files" in tables
        assert "fts_chunks" in tables
        assert "git_commits" in tables
        assert "activities" in tables
        assert "notes" in tables
        assert "context_sessions" in tables

        # Test FTS5 matching
        with db.transaction() as cur:
            cur.execute("""
            INSERT INTO fts_files (file_id, filename, relative_path, symbols, content, project_name)
            VALUES ('f1', 'search_engine.py', 'services/search_engine.py', 'SearchEngine search', 'Hybrid retrieval using SQLite FTS5 and vector cosine', 'Groundwork');
            """)

        results = conn.execute("SELECT file_id, filename FROM fts_files WHERE fts_files MATCH 'retrieval';").fetchall()
        assert len(results) == 1
        assert results[0]["filename"] == "search_engine.py"
        db.close()
