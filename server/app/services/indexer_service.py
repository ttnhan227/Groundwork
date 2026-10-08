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

    @property
    def embeddings(self):
        if self._embeddings is None:
            self._embeddings = get_embedding_engine()
        return self._embeddings

    def __init__(self) -> None:
        self.settings = get_settings()
        self.parser = FileParser()
        self._embeddings = None
        self.workspace_service = WorkspaceService()
        self.project_service = ProjectService()
        self.git_service = GitService()
        self.activity_service = ActivityService()

        self._lock = threading.Lock()
        self._cancel_requested = threading.Event()
        self._worker_thread: threading.Thread | None = None
        self._pending_reindex = False
        self._resume_requested = False

        self._progress = IndexProgress(status=IndexStatus.IDLE)

    @classmethod
    def get_instance(cls) -> IndexerService:
        if cls._instance is None:
            cls._instance = IndexerService()
        return cls._instance

    def get_progress(self) -> IndexProgress:
        with self._lock:
            return self._progress.model_copy()

    def start_indexing(self, workspace_id: str | None = None, target_paths: list[str] | None = None, resume: bool = False) -> IndexProgress:
        """Starts indexing in a background worker thread."""
        with self._lock:
            if self._worker_thread and self._worker_thread.is_alive():
                self._pending_reindex = True
                if resume and self._cancel_requested.is_set():
                    self._resume_requested = True
                return self._progress.model_copy()

            self._cancel_requested.clear()
            self._pending_reindex = False
            self._resume_requested = False
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
                args=(run_id, workspace_id, target_paths),
                name="GroundworkIndexerWorker",
                daemon=True,
            )
            self._worker_thread.start()

            return self._progress.model_copy()

    def index_selected_paths(self, paths: list[str], workspace_id: str | None = None) -> IndexProgress:
        """Indexes user-selected files explicitly with dedicated progress."""
        return self.start_indexing(workspace_id=workspace_id, target_paths=paths, resume=True)

    def _background_index_loop(self, run_id: str, workspace_id: str | None, target_paths: list[str] | None = None) -> None:
        while True:
            self._run_indexing_worker(run_id, workspace_id, target_paths)
            with self._lock:
                if not self._pending_reindex or (self._cancel_requested.is_set() and not self._resume_requested):
                    return
                self._pending_reindex = False
                self._resume_requested = False
                self._cancel_requested.clear()
                run_id = str(uuid.uuid4())
                workspace_id = None
                target_paths = None
                self._progress = IndexProgress(run_id=run_id, status=IndexStatus.INDEXING, started_at=datetime.now(timezone.utc).isoformat())

    def cancel_indexing(self) -> IndexProgress:
        """Requests cancellation of ongoing indexing run."""
        with self._lock:
            self._pending_reindex = False
            self._resume_requested = False
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

    def _run_indexing_worker(self, run_id: str, target_workspace_id: str | None, target_paths: list[str] | None = None) -> None:
        """Worker loop executed in a background daemon thread."""
        logger.info("Indexing worker started (run %s)", run_id)
        start_time = datetime.now(timezone.utc)

        try:
            from app.services.inventory_service import InventoryService
            inventory = InventoryService()
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

                with self._lock:
                    self._progress.current_workspace = ws.name
                    self._progress.phase = "scanning"
                    self._progress.current_file = None
                inventory_count = self._progress.files_inventoried
                previous_errors = self._progress.errors.copy()
                def report_inventory(count, directory, errors, inventory_count=inventory_count, previous_errors=previous_errors):
                    with self._lock:
                        self._progress.current_file = directory
                        self._progress.files_inventoried = inventory_count + count
                        self._progress.errors = (previous_errors + errors)[-50:]
                inventory.scan(ws, self._cancel_requested.is_set, report_inventory)
                if self._cancel_requested.is_set():
                    break
            # Discover eligible content across roots before reporting a percentage.
            content_files = []
            for ws in workspaces:
                if self._cancel_requested.is_set():
                    break
                ws_path = Path(ws.path)
                if not ws_path.exists():
                    continue
                with self._lock:
                    self._progress.current_workspace = ws.name
                    self._progress.phase = "content_discovery"

                if target_paths:
                    selected_files = []
                    for p in target_paths:
                        try:
                            rp = Path(p).resolve()
                            if rp.is_relative_to(ws_path) and rp.is_file() and self.parser.is_supported(rp):
                                selected_files.append(rp)
                        except (ValueError, OSError):
                            pass
                    file_paths = selected_files
                else:
                    file_paths = self._discover_files(ws_path, ws.ignore_patterns)

                total_discovered += len(file_paths)
                with self._lock:
                    self._progress.files_discovered = total_discovered
                content_files.append((ws, file_paths))
            for ws, file_paths in content_files:
                ws_path = Path(ws.path)
                with self._lock:
                    self._progress.current_workspace = ws.name
                    self._progress.phase = "projects"
                if self._cancel_requested.is_set():
                    break
                projects = self.project_service.discover_projects_in_workspace(ws.id, ws_path)
                with self._lock:
                    self._progress.phase = "history"
                for proj in projects:
                    if self._cancel_requested.is_set():
                        break
                    if (Path(proj["path"]) / ".git").exists():
                        with self._lock:
                            self._progress.current_file = Path(proj["path"]).name
                        self.git_service.sync_project_commits(proj["id"], Path(proj["path"]))
                with self._lock:
                    self._progress.phase = "indexing"

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
                        self._progress.percent = round((total_indexed + total_skipped) / max(1, total_discovered) * 100, 1)

            finished_iso = datetime.now(timezone.utc).isoformat()
            final_status = IndexStatus.CANCELLED if self._cancel_requested.is_set() else IndexStatus.COMPLETED

            with self._lock:
                self._progress.status = final_status
                self._progress.finished_at = finished_iso
                self._progress.percent = 100.0 if final_status == IndexStatus.COMPLETED else self._progress.percent

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
                activity_type=ActivityType.INDEXING_RUN,
                summary=f"Workspace indexing {final_status.value}: {total_indexed} files updated, {total_skipped} skipped.",
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
        fpath = fpath.resolve()
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
            if not conn.in_transaction:
                conn.execute("BEGIN IMMEDIATE")
            # A slow parser must not overwrite a newer watcher update. Check
            # the source after obtaining the write lock, before changing rows.
            try:
                latest = fpath.stat()
                if latest.st_mtime_ns != stat.st_mtime_ns or latest.st_size != stat.st_size:
                    return False
                latest_hash = self.embeddings.model_id + ":" + hashlib.sha256(fpath.read_bytes()).hexdigest()
            except OSError:
                return False
            if latest_hash != file_hash:
                return False
            stored = conn.execute("""
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
                symbols_json = excluded.symbols_json
            RETURNING id;
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
            )).fetchone()
            # Another indexer may have inserted this path since our initial
            # lookup. All dependent records must use the retained row identity.
            file_id = stored["id"]

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
        """Remove a deleted path and its descendants from content search."""
        conn = self.db.get_connection()
        prefix = file_path_str.rstrip("\\/") + os.sep
        with conn:
            rows = conn.execute("SELECT id FROM files WHERE path = ? COLLATE NOCASE OR substr(path,1,?) = ? COLLATE NOCASE;", (file_path_str, len(prefix), prefix)).fetchall()
            for row in rows:
                file_id = row["id"]
                conn.execute("DELETE FROM fts_files WHERE file_id = ?;", (file_id,))
                conn.execute("DELETE FROM fts_chunks WHERE file_id = ?;", (file_id,))
                conn.execute("DELETE FROM chunks WHERE file_id = ?;", (file_id,))
                conn.execute("DELETE FROM files WHERE id = ?;", (file_id,))

    def _discover_files(self, root: Path, ignore_patterns: list[str]) -> list[Path]:
        """Walks directory, honoring ignore patterns and .gitignore with rule caching."""
        from app.services.exclusion_cache import ExclusionRuleCache
        rule_cache = ExclusionRuleCache(self.settings.default_ignore_patterns, ignore_patterns, root)
        discovered: list[Path] = []
        gitignores = self._load_gitignore(root)

        initial_count = self.get_progress().files_discovered
        for dirpath, dirnames, filenames in os.walk(str(root)):
            if self._cancel_requested.is_set():
                break
            with self._lock:
                self._progress.current_file = str(Path(dirpath).relative_to(root))
            # Filter directories
            filtered_dirs = []
            for d in dirnames:
                if rule_cache.is_fast_ignorable_dir(d):
                    continue
                full_dir = Path(dirpath) / d
                if self._is_ignored(full_dir, ignore_patterns, gitignores, root):
                    continue
                filtered_dirs.append(d)
            dirnames[:] = filtered_dirs

            for fname in filenames:
                if self._cancel_requested.is_set():
                    break
                fpath = Path(dirpath) / fname
                if self._is_ignored(fpath, ignore_patterns, gitignores, root):
                    continue
                if self.parser.is_supported(fpath):
                    discovered.append(fpath)
                    with self._lock:
                        self._progress.files_discovered = initial_count + len(discovered)

        return discovered

    def _is_ignored(self, path: Path, ignore_patterns: list[str], gitignores: list[str], root: Path, passive_preview: bool = False) -> bool:
        try:
            resolved = path.resolve()
            root = root.resolve()
            rel = resolved.relative_to(root).as_posix()
        except ValueError:
            return True
        # Never index credentials or links (including links within a workspace).
        sensitive = {".env", "id_rsa", "id_ed25519", "credentials", "credentials.json", ".npmrc", ".pypirc", ".netrc", "preferences.dat", "service-account.json", "secrets.json", "secrets.yaml", "secrets.yml"}
        if path.is_symlink() or path.is_junction() or path.name.lower() in sensitive or path.suffix.lower() in {".pem", ".key", ".p12", ".pfx"} or path.name.lower().startswith(".env.") and path.name.lower() != ".env.example":
            return True
        private_folders = {".ssh", ".aws", ".azure", ".gnupg", ".kube"}
        name = path.name.lower()
        if private_folders.intersection(part.lower() for part in path.relative_to(root).parts) or name == "application_default_credentials.json" or name == "kubeconfig.yaml" or name.startswith(("client_secret", "service_account", "service-account")) and path.suffix.lower() == ".json":
            return True
        path = resolved
        suffix = "/" if path.is_dir() else ""

        patterns = self.settings.default_ignore_patterns + ignore_patterns
        if passive_preview:
            # These default exclusions avoid indexing binary media, rather than
            # denying a user-requested passive preview or metadata reference.
            binary_defaults = {p for p in self.settings.default_ignore_patterns if p.startswith('*.')}
            # Older workspaces stored a full copy of the indexing defaults.
            # Preserve their established preview behavior. New workspaces store
            # only explicit exclusions, which are always honored.
            legacy_defaults = set(self.settings.default_ignore_patterns).issubset(ignore_patterns)
            explicit = [p for p in ignore_patterns if not legacy_defaults or p not in binary_defaults]
            patterns = [p for p in self.settings.default_ignore_patterns if p not in binary_defaults] + explicit
        spec_key = tuple(sorted(patterns))
        if not hasattr(self, "_spec_cache"):
            self._spec_cache = {}
        if spec_key not in self._spec_cache:
            self._spec_cache[spec_key] = pathspec.GitIgnoreSpec.from_lines(list(spec_key))
        spec = self._spec_cache[spec_key]
        if spec.match_file(rel + suffix):
            return True

        if not hasattr(self, "_gi_spec_cache"):
            self._gi_spec_cache = {}

        # Apply each ancestor's Git rules in order, respecting negations and anchors.
        ignored = False
        parents = [root]
        current = root
        for part in path.relative_to(root).parts[:-1]:
            current = current / part
            parents.append(current)
        for parent in parents:
            gi_file = parent / ".gitignore"
            gi_mtime = None
            if gi_file.is_file():
                try:
                    gi_mtime = gi_file.stat().st_mtime
                except OSError:
                    pass
            cached = self._gi_spec_cache.get(parent)
            if cached is None or cached[0] != gi_mtime:
                rules = self._load_gitignore(parent)
                p_spec = pathspec.GitIgnoreSpec.from_lines(rules) if rules else None
                self._gi_spec_cache[parent] = (gi_mtime, p_spec)
            p_spec = self._gi_spec_cache[parent][1]
            if p_spec:
                result = p_spec.check_file(path.relative_to(parent).as_posix() + suffix)
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
