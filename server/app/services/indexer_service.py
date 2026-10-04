"""Local indexing service with background workers, file hashing, and crash recovery.

Performs:
1. Recursive file discovery with .gitignore & pattern filtering.
2. Fast hash-based change detection (skips unchanged files).
3. Incremental updates & deletion sync.
4. Parsing, AST symbol extraction, and chunking.
5. FTS5 full-text indexing & local vector embeddings.
6. Non-blocking background execution with live progress reporting.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pathspec

from app.core.config import get_settings
from app.database.local_db import LocalDatabase, get_db
from app.models.types import ActivityType, IndexProgress, IndexStatus
from app.services.activity_service import ActivityService
from app.services.embeddings import get_embedding_engine
from app.services.file_parser import FileParser
from app.services.git_service import GitService
from app.services.project_service import ProjectService
from app.services.workspace_service import WorkspaceService

logger = logging.getLogger("groundwork.indexer")


class IndexerService:
    """Manages background workspace indexing, hashing, and incremental updates."""

    _instance: IndexerService | None = None

    @property
    def db(self) -> LocalDatabase:
        return get_db()

    def __init__(self) -> None:
        self.settings = get_settings()
        self.parser = FileParser()
        self.embeddings = get_embedding_engine()
        self.workspace_service = WorkspaceService()
        self.project_service = ProjectService()
        self.git_service = GitService()
        self.activity_service = ActivityService()

        self._lock = threading.Lock()
        self._cancel_requested = threading.Event()
        self._worker_thread: threading.Thread | None = None
        self._pending_reindex = False

        self._progress = IndexProgress(status=IndexStatus.IDLE)

    @classmethod
    def get_instance(cls) -> IndexerService:
        if cls._instance is None:
            cls._instance = IndexerService()
        return cls._instance

    def get_progress(self) -> IndexProgress:
        with self._lock:
            return self._progress.model_copy()

    def start_indexing(self, workspace_id: str | None = None) -> IndexProgress:
        """Starts indexing in a background worker thread."""
        with self._lock:
            if self._worker_thread and self._worker_thread.is_alive():
                self._pending_reindex = True
                return self._progress.model_copy()

            self._cancel_requested.clear()
            run_id = str(uuid.uuid4())
            now_iso = datetime.now(timezone.utc).isoformat()
            self._progress = IndexProgress(
                run_id=run_id,
                status=IndexStatus.INDEXING,
                current_workspace=workspace_id,
                started_at=now_iso,
            )

            self._worker_thread = threading.Thread(
                target=self._background_index_loop,
                args=(run_id, workspace_id),
                name="GroundworkIndexerWorker",
                daemon=True,
            )
            self._worker_thread.start()

            return self._progress.model_copy()

    def _background_index_loop(self, run_id: str, workspace_id: str | None) -> None:
        while True:
            self._run_indexing_worker(run_id, workspace_id)
            with self._lock:
                if not self._pending_reindex or self._cancel_requested.is_set():
                    return
                self._pending_reindex = False
                run_id = str(uuid.uuid4())
                workspace_id = None
                self._progress = IndexProgress(run_id=run_id, status=IndexStatus.INDEXING, started_at=datetime.now(timezone.utc).isoformat())

    def cancel_indexing(self) -> IndexProgress:
        """Requests cancellation of ongoing indexing run."""
        with self._lock:
            self._pending_reindex = False
            if self._progress.status == IndexStatus.INDEXING:
                self._cancel_requested.set()
                self._progress.status = IndexStatus.CANCELLED
            return self._progress.model_copy()

    def wait_for_completion(self, timeout: float = 5.0) -> None:
        """Waits for running indexing worker thread to complete."""
        thread = self._worker_thread
        if thread and thread.is_alive():
            thread.join(timeout=timeout)

    def index_workspace_sync(self, workspace_id: str | None = None) -> IndexProgress:
        """Executes workspace indexing synchronously for immediate processing and tests."""
        self._cancel_requested.clear()
        run_id = str(uuid.uuid4())
        self._progress = IndexProgress(run_id=run_id, status=IndexStatus.INDEXING)
        self._run_indexing_worker(run_id, workspace_id)
        return self.get_progress()

    index_workspace = index_workspace_sync

    def _run_indexing_worker(self, run_id: str, target_workspace_id: str | None) -> None:
        """Worker loop executed in a background daemon thread."""
        logger.info("Indexing worker started (run %s)", run_id)
        start_time = datetime.now(timezone.utc)

        try:
            workspaces = [w for w in self.workspace_service.list_workspaces() if w.is_active]
            if target_workspace_id:
                workspaces = [w for w in workspaces if w.id == target_workspace_id]

            if not workspaces:
                logger.info("No active workspaces found for indexing")
                with self._lock:
                    self._progress.status = IndexStatus.COMPLETED
                    self._progress.finished_at = datetime.now(timezone.utc).isoformat()
                return

            total_discovered = 0
            total_indexed = 0
            total_skipped = 0

            for ws in workspaces:
                if self._cancel_requested.is_set():
                    break

                ws_path = Path(ws.path)
                if not ws_path.exists():
                    continue

                # 1. Discover and synchronize projects first
                projects = self.project_service.discover_projects_in_workspace(ws.id, ws_path)
                for proj in projects:
                    if (Path(proj["path"]) / ".git").exists():
                        self.git_service.sync_project_commits(proj["id"], Path(proj["path"]))

                # 2. Discover files
                file_paths = self._discover_files(ws_path, ws.ignore_patterns)
                total_discovered += len(file_paths)
                with self._lock:
                    self._progress.files_discovered = total_discovered

                # 3. Clean up deleted files from database
                self._cleanup_deleted_files(ws.id, file_paths)

                # 4. Index each file incrementally
                for _idx, fpath in enumerate(file_paths):
                    if self._cancel_requested.is_set():
                        break

                    with self._lock:
                        self._progress.current_file = str(fpath.name)
                        self._progress.percent = round((total_indexed + total_skipped) / max(1, total_discovered) * 100, 1)

                    try:
                        was_indexed = self.index_single_file(fpath, ws.id, projects)
                        if was_indexed:
                            total_indexed += 1
                        else:
                            total_skipped += 1
                    except Exception as exc:
                        logger.warning("Error indexing file %s: %s", fpath, exc)
                        total_skipped += 1
                        with self._lock:
                            self._progress.errors.append(f"{fpath.name}: {exc}")

                    with self._lock:
                        self._progress.files_indexed = total_indexed
                        self._progress.files_skipped = total_skipped

            finished_iso = datetime.now(timezone.utc).isoformat()
            final_status = IndexStatus.CANCELLED if self._cancel_requested.is_set() else IndexStatus.COMPLETED

            with self._lock:
                self._progress.status = final_status
                self._progress.finished_at = finished_iso
                self._progress.percent = 100.0

            # Record run in database
            first_ws = workspaces[0].id if workspaces else "unknown"
            conn = self.db.get_connection()
            with conn:
                conn.execute("""
                INSERT INTO indexing_runs (
                    id, workspace_id, status, files_discovered, files_indexed,
                    files_skipped, started_at, finished_at, error_log_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                """, (
                    run_id,
                    first_ws,
                    final_status.value,
                    total_discovered,
                    total_indexed,
                    total_skipped,
                    start_time.isoformat(),
                    finished_iso,
                    json.dumps(self._progress.errors[:50]),
                ))

            # Record activity
            self.activity_service.record_activity(
                workspace_id=first_ws,
                activity_type=ActivityType.FILE_CREATED,
                summary=f"Workspace indexing completed: {total_indexed} files updated, {total_skipped} skipped.",
                details={"discovered": total_discovered, "indexed": total_indexed, "skipped": total_skipped},
            )

            logger.info("Indexing finished: %d indexed, %d skipped", total_indexed, total_skipped)

        except Exception as exc:
            logger.exception("Fatal error in indexing worker: %s", exc)
            with self._lock:
                self._progress.status = IndexStatus.FAILED
                self._progress.finished_at = datetime.now(timezone.utc).isoformat()
                self._progress.errors.append(str(exc))

    def index_single_file(self, fpath: Path, workspace_id: str, projects: list[dict[str, Any]] | None = None) -> bool:
        """Parses and indexes a single file. Returns True if indexed, False if skipped."""
        ws = self.workspace_service.get_workspace(workspace_id)
        if not ws or not ws.is_active:
            return False
        root = Path(ws.path).resolve()
        if self._is_ignored(fpath, ws.ignore_patterns, [], root) or not self.parser.is_supported(fpath):
            self.remove_file(str(fpath))
            return False
        if not fpath.exists() or not fpath.is_file():
            return False

        try:
            stat = fpath.stat()
        except OSError:
            return False

        if stat.st_size > self.settings.max_file_size_bytes or stat.st_size == 0:
            self.remove_file(str(fpath))
            return False

        # Compute fast hash
        file_hash = self.embeddings.model_id + ":" + hashlib.sha256(fpath.read_bytes()).hexdigest()

        # Check existing hash in database
        conn = self.db.get_connection()
        row = conn.execute("SELECT id, hash FROM files WHERE path = ?;", (str(fpath),)).fetchone()
        # Associate with nearest project
        proj_id = None
        proj_name = ""
        if projects:
            for p in sorted(projects, key=lambda item: len(Path(item["path"]).parts), reverse=True):
                p_path = Path(p["path"])
                try:
                    fpath.relative_to(p_path)
                    proj_id = p["id"]
                    proj_name = p["name"]
                    break
                except ValueError:
                    pass

        if row and row["hash"] == file_hash:
            with conn:
                conn.execute("UPDATE files SET project_id = ?, workspace_id = ?, relative_path = ? WHERE id = ?", (proj_id, workspace_id, str(fpath.relative_to(root)), row["id"]))
            return False

        # Parse text, AST symbols, and chunks
        parse_result = self.parser.parse_file(fpath, max_size_bytes=self.settings.max_file_size_bytes)
        if parse_result.is_binary or not parse_result.content.strip():
            self.remove_file(str(fpath))
            return False

        file_id = row["id"] if row else str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        rel_path = str(fpath.name)
        try:
            rel_path = str(fpath.relative_to(root))
        except Exception:
            pass

        symbols_data = [
            {"kind": s.kind, "name": s.name, "line": s.line, "details": s.details}
            for s in parse_result.symbols
        ]
        symbols_text = " ".join([f"{s.name} ({s.kind})" for s in parse_result.symbols])

        with conn:
            # 1. Upsert files table
            conn.execute("""
            INSERT INTO files (
                id, workspace_id, project_id, path, relative_path, filename,
                extension, file_type, size_bytes, hash, mtime, indexed_at, symbols_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                workspace_id = excluded.workspace_id,
                project_id = excluded.project_id,
                relative_path = excluded.relative_path,
                file_type = excluded.file_type,
                hash = excluded.hash,
                mtime = excluded.mtime,
                size_bytes = excluded.size_bytes,
                indexed_at = excluded.indexed_at,
                symbols_json = excluded.symbols_json;
            """, (
                file_id,
                workspace_id,
                proj_id,
                str(fpath),
                rel_path,
                fpath.name,
                fpath.suffix.lower(),
                parse_result.file_type,
                stat.st_size,
                file_hash,
                stat.st_mtime,
                now_iso,
                json.dumps(symbols_data),
            ))

            # 2. Clean previous chunks & FTS records for this file
            conn.execute("DELETE FROM chunks WHERE file_id = ?;", (file_id,))
            conn.execute("DELETE FROM fts_files WHERE file_id = ?;", (file_id,))
            conn.execute("DELETE FROM fts_chunks WHERE file_id = ?;", (file_id,))

            # 3. Insert FTS file record
            conn.execute("""
            INSERT INTO fts_files (file_id, filename, relative_path, symbols, content, project_name)
            VALUES (?, ?, ?, ?, ?, ?);
            """, (
                file_id,
                fpath.name,
                rel_path,
                symbols_text,
                parse_result.content[:50000],  # Index up to first 50k chars in file FTS
                proj_name,
            ))

            # 4. Insert chunks and chunk FTS records in batches
            if parse_result.chunks:
                chunk_rows = []
                fts_chunk_rows = []
                for chunk in parse_result.chunks:
                    chunk_id = str(uuid.uuid4())
                    embedding = self.embeddings.embed_text(chunk.content)
                    chunk_rows.append((
                        chunk_id,
                        file_id,
                        chunk.chunk_index,
                        chunk.content,
                        chunk.char_start,
                        chunk.char_end,
                        chunk.line_start,
                        chunk.line_end,
                        json.dumps(embedding),
                    ))
                    fts_chunk_rows.append((
                        chunk_id,
                        file_id,
                        chunk.content,
                        fpath.name,
                        rel_path,
                    ))

                conn.executemany("""
                INSERT INTO chunks (
                    id, file_id, chunk_index, content, char_start, char_end,
                    line_start, line_end, embedding_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                """, chunk_rows)

                conn.executemany("""
                INSERT INTO fts_chunks (chunk_id, file_id, content, filename, relative_path)
                VALUES (?, ?, ?, ?, ?);
                """, fts_chunk_rows)

        return True

    def remove_file(self, file_path_str: str) -> None:
        """Removes a deleted file from SQLite and FTS tables."""
        conn = self.db.get_connection()
        with conn:
            row = conn.execute("SELECT id FROM files WHERE path = ?;", (file_path_str,)).fetchone()
            if row:
                file_id = row["id"]
                conn.execute("DELETE FROM fts_files WHERE file_id = ?;", (file_id,))
                conn.execute("DELETE FROM fts_chunks WHERE file_id = ?;", (file_id,))
                conn.execute("DELETE FROM chunks WHERE file_id = ?;", (file_id,))
                conn.execute("DELETE FROM files WHERE id = ?;", (file_id,))

    def _discover_files(self, root: Path, ignore_patterns: list[str]) -> list[Path]:
        """Walks directory, honoring ignore patterns and .gitignore."""
        discovered: list[Path] = []
        gitignores = self._load_gitignore(root)

        for dirpath, dirnames, filenames in os.walk(str(root)):
            # Filter directories
            filtered_dirs = []
            for d in dirnames:
                full_dir = Path(dirpath) / d
                if self._is_ignored(full_dir, ignore_patterns, gitignores, root):
                    continue
                filtered_dirs.append(d)
            dirnames[:] = filtered_dirs

            for fname in filenames:
                fpath = Path(dirpath) / fname
                if self._is_ignored(fpath, ignore_patterns, gitignores, root):
                    continue
                if self.parser.is_supported(fpath):
                    discovered.append(fpath)

        return discovered

    def _is_ignored(self, path: Path, ignore_patterns: list[str], gitignores: list[str], root: Path) -> bool:
        try:
            path.resolve().relative_to(root.resolve())
            rel = path.relative_to(root).as_posix()
        except ValueError:
            return True
        # Never index credentials or links (including links within a workspace).
        sensitive = {".env", "id_rsa", "id_ed25519", "credentials", "credentials.json"}
        if path.is_symlink() or path.is_junction() or path.name.lower() in sensitive or path.suffix.lower() in {".pem", ".key", ".p12", ".pfx"} or path.name.lower().startswith(".env.") and path.name.lower() != ".env.example":
            return True
        suffix = "/" if path.is_dir() else ""
        spec = pathspec.GitIgnoreSpec.from_lines(self.settings.default_ignore_patterns + ignore_patterns)
        if spec.match_file(rel + suffix):
            return True
        # Apply each ancestor's Git rules in order, respecting negations and anchors.
        ignored = False
        parents = [root]
        current = root
        for part in path.relative_to(root).parts[:-1]:
            current = current / part
            parents.append(current)
        for parent in parents:
            rules = self._load_gitignore(parent)
            if rules:
                result = pathspec.GitIgnoreSpec.from_lines(rules).check_file(path.relative_to(parent).as_posix() + suffix)
                if result.include is not None:
                    ignored = result.include
        return ignored

    def _load_gitignore(self, root: Path) -> list[str]:
        rules: list[str] = []
        gi = root / ".gitignore"
        if gi.exists():
            try:
                for line in gi.read_text(encoding="utf-8").splitlines():
                    s = line.strip()
                    if s and not s.startswith("#"):
                        rules.append(s)
            except Exception:
                pass
        return rules

    def _cleanup_deleted_files(self, workspace_id: str, current_files: list[Path]) -> None:
        """Removes records for files no longer existing on disk."""
        current_paths = {str(p) for p in current_files}
        conn = self.db.get_connection()
        rows = conn.execute("SELECT id, path FROM files WHERE workspace_id = ?;", (workspace_id,)).fetchall()
        for r in rows:
            if r["path"] not in current_paths:
                self.remove_file(r["path"])
