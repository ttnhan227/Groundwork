"""Local SQLite database manager for Groundwork.

Configures SQLite in WAL mode with FTS5 virtual tables for high-performance
full-text indexing, vector chunk storage, and atomic transactions.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

from app.core.config import get_settings

logger = logging.getLogger("groundwork.db")


class LocalDatabase:
    """Thread-safe SQLite database manager for Groundwork Local."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or get_settings().get_database_path()
        self._local = threading.local()
        self._lock = threading.RLock()
        self._connections: list[sqlite3.Connection] = []
        self.init_schema()

    def get_connection(self) -> sqlite3.Connection:
        """Gets or creates a thread-local SQLite connection with proper PRAGMAs."""
        if not hasattr(self._local, "connection") or self._local.connection is None:
            conn = sqlite3.connect(
                str(self.db_path),
                timeout=30.0,
                check_same_thread=False,
            )
            conn.row_factory = sqlite3.Row
            # Enable WAL mode for high concurrency between reader threads and background indexer
            conn.execute("PRAGMA journal_mode = WAL;")
            conn.execute("PRAGMA synchronous = NORMAL;")
            conn.execute("PRAGMA foreign_keys = ON;")
            conn.execute("PRAGMA temp_store = MEMORY;")
            self._local.connection = conn
            with self._lock:
                self._connections.append(conn)
        return self._local.connection

    @contextmanager
    def transaction(self) -> Generator[sqlite3.Cursor, None, None]:
        """Provides an atomic transaction context with rollback on error."""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            yield cursor
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cursor.close()

    def init_schema(self) -> None:
        """Initializes tables, indexes, and FTS5 virtual tables."""
        with self._lock:
            conn = self.get_connection()
            with conn:
                # 1. Workspaces
                conn.execute("""
                CREATE TABLE IF NOT EXISTS workspaces (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL UNIQUE,
                    is_active INTEGER DEFAULT 1,
                    ignore_patterns TEXT DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """)

                # 2. Projects
                conn.execute("""
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL UNIQUE,
                    detected_type TEXT NOT NULL,
                    language TEXT NOT NULL,
                    frameworks TEXT DEFAULT '[]',
                    git_remote TEXT,
                    git_branch TEXT,
                    last_modified TEXT,
                    metadata_json TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
                );
                """)

                # 3. Files
                conn.execute("""
                CREATE TABLE IF NOT EXISTS files (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    project_id TEXT,
                    path TEXT NOT NULL UNIQUE,
                    relative_path TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    extension TEXT,
                    file_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    hash TEXT NOT NULL,
                    mtime REAL NOT NULL,
                    indexed_at TEXT NOT NULL,
                    symbols_json TEXT DEFAULT '[]',
                    FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
                );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);")

                # 4. Chunks
                conn.execute("""
                CREATE TABLE IF NOT EXISTS chunks (
                    id TEXT PRIMARY KEY,
                    file_id TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    char_start INTEGER NOT NULL,
                    char_end INTEGER NOT NULL,
                    line_start INTEGER NOT NULL,
                    line_end INTEGER NOT NULL,
                    embedding_json TEXT,
                    FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
                );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);")

                # 5. FTS5 Virtual Tables
                conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS fts_files USING fts5(
                    file_id UNINDEXED,
                    filename,
                    relative_path,
                    symbols,
                    content,
                    project_name,
                    tokenize = 'porter unicode61'
                );
                """)

                conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
                    chunk_id UNINDEXED,
                    file_id UNINDEXED,
                    content,
                    filename,
                    relative_path,
                    tokenize = 'porter unicode61'
                );
                """)

                # 6. Git Commits
                conn.execute("""
                CREATE TABLE IF NOT EXISTS git_commits (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    commit_hash TEXT NOT NULL,
                    author TEXT,
                    date TEXT NOT NULL,
                    message TEXT NOT NULL,
                    changed_files_json TEXT DEFAULT '[]',
                    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_git_project ON git_commits(project_id);")

                # 7. Activities
                conn.execute("""
                CREATE TABLE IF NOT EXISTS activities (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT,
                    project_id TEXT,
                    activity_type TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    details_json TEXT DEFAULT '{}',
                    timestamp TEXT NOT NULL
                );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_activities_time ON activities(timestamp DESC);")

                # 8. Notes
                conn.execute("""
                CREATE TABLE IF NOT EXISTS notes (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    project_id TEXT,
                    file_path TEXT,
                    tags_json TEXT DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    sync_version INTEGER DEFAULT 1,
                    sync_status TEXT DEFAULT 'synced',
                    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
                );
                """)

                # 9. Context Sessions ("Continue Where I Left Off")
                conn.execute("""
                CREATE TABLE IF NOT EXISTS context_sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    project_id TEXT,
                    status TEXT DEFAULT 'active',
                    started_at TEXT NOT NULL,
                    last_active_at TEXT NOT NULL,
                    files_inspected_json TEXT DEFAULT '[]',
                    git_commits_json TEXT DEFAULT '[]',
                    notes_json TEXT DEFAULT '[]',
                    todos_json TEXT DEFAULT '[]',
                    last_command TEXT,
                    summary TEXT,
                    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
                );
                """)

                # 10. Saved Searches
                conn.execute("""
                CREATE TABLE IF NOT EXISTS saved_searches (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    query TEXT NOT NULL,
                    filters_json TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    sync_version INTEGER DEFAULT 1
                );
                """)

                # 11. Key-Value Settings
                conn.execute("""
                CREATE TABLE IF NOT EXISTS settings_kv (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """)

                # 12. Indexing Runs Log
                conn.execute("""
                CREATE TABLE IF NOT EXISTS indexing_runs (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    files_discovered INTEGER DEFAULT 0,
                    files_indexed INTEGER DEFAULT 0,
                    files_skipped INTEGER DEFAULT 0,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    error_log_json TEXT DEFAULT '[]',
                    FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
                );
                """)

                # 13. Sync Queue (for offline changes)
                conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_queue (
                    id TEXT PRIMARY KEY,
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    attempts INTEGER DEFAULT 0
                );
                """)

    def close(self) -> None:
        """Closes all open database connections."""
        with self._lock:
            for conn in list(self._connections):
                try:
                    conn.close()
                except Exception:
                    pass
            self._connections.clear()
        if hasattr(self._local, "connection"):
            self._local.connection = None


_db_instance: LocalDatabase | None = None


def get_db(db_path: Path | None = None) -> LocalDatabase:
    """Singleton getter for the local database manager."""
    global _db_instance
    target = db_path or get_settings().get_database_path()
    if _db_instance is None or _db_instance.db_path != target:
        if _db_instance:
            _db_instance.close()
        _db_instance = LocalDatabase(target)
    return _db_instance


def reset_db() -> None:
    """Resets the singleton database instance and closes open connections."""
    global _db_instance
    if _db_instance is not None:
        _db_instance.close()
        _db_instance = None
