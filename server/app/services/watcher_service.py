"""Filesystem watcher service using watchfiles.

Monitors active workspace folders, debounces file change bursts,
and automatically triggers incremental indexing and activity logging.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Set

import watchfiles
from watchfiles import Change

from app.core.config import get_settings
from app.models.types import ActivityType, IndexStatus
from app.services.activity_service import ActivityService
from app.services.indexer_service import IndexerService
from app.services.project_service import ProjectService
from app.services.workspace_service import WorkspaceService

logger = logging.getLogger("groundwork.watcher")


class WatcherService:
    """Watches local workspace directories and dispatches incremental updates."""

    _instance: WatcherService | None = None

    def __init__(self) -> None:
        self.settings = get_settings()
        self.workspace_service = WorkspaceService()
        self.indexer_service = IndexerService.get_instance()
        self.project_service = ProjectService()
        self.activity_service = ActivityService()

        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._watched_paths: Set[str] = set()

    @classmethod
    def get_instance(cls) -> WatcherService:
        if cls._instance is None:
            cls._instance = WatcherService()
        return cls._instance

    def start(self) -> None:
        """Starts the watcher background thread."""
        if self._thread and self._thread.is_alive():
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._watch_loop,
            name="GroundworkWatcherThread",
            daemon=True,
        )
        self._thread.start()
        logger.info("Workspace filesystem watcher started")

    def stop(self) -> None:
        """Stops the watcher thread."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=2.0)
            self._thread = None
        logger.info("Workspace filesystem watcher stopped")

    def _watch_loop(self) -> None:
        """Continuous watching loop over all active workspace roots."""
        while not self._stop_event.is_set():
            roots = self.workspace_service.get_allowed_roots()
            existing_roots = [p for p in roots if p.exists()]

            if not existing_roots:
                time.sleep(2.0)
                continue

            try:
                reconcile_after_registration = True
                # Watch all existing roots with watchfiles
                for changes in watchfiles.watch(
                    *existing_roots,
                    stop_event=self._stop_event,
                    debounce=600,
                    step=200,
                    yield_on_timeout=True,
                    watch_filter=None,
                    rust_timeout=1000,
                ):
                    # Registration is lazy; reconcile changes that happened
                    # between the original scan and the watcher starting.
                    if reconcile_after_registration:
                        reconcile_after_registration = False
                        if self.indexer_service.get_progress().status != IndexStatus.CANCELLED:
                            self.indexer_service.start_indexing()
                    if set(existing_roots) != set(self.workspace_service.get_allowed_roots()):
                        break
                    if changes:
                        self._handle_changes(changes)
            except Exception as exc:
                if not self._stop_event.is_set():
                    logger.debug("Watcher reconnecting after event: %s", exc)
                    time.sleep(1.0)

    def _handle_changes(self, changes: set[tuple[Change, str]]) -> None:
        """Processes debounced filesystem events."""
        from app.services.inventory_service import InventoryService
        inventory = InventoryService()
        projects = self.project_service.list_projects()
        projects_dict = [p.model_dump() for p in projects]
        database = self.settings.get_database_path()
        runtime_files = {database, Path(str(database) + "-wal"), Path(str(database) + "-shm"), database.parent / "local-core.log", database.parent / "preferences.dat", database.parent / "preferences.tmp"}

        touched = set()
        rescan = False
        for change_type, path_str in changes:
            fpath = Path(path_str)
            if fpath.resolve() in runtime_files:
                continue

            matching = self._find_workspaces_for_path(fpath)
            matching = [ws for ws in matching if not any(parent.is_symlink() or parent.is_junction() for parent in fpath.parents if parent != Path(ws.path) and parent.is_relative_to(Path(ws.path)))]
            ws = matching[0] if matching else None
            for membership in matching:
                inventory.update_path(membership, fpath, refresh=False)
                touched.add(membership.id)
            if ws:
                if change_type == Change.added and fpath.is_dir() and not fpath.is_symlink() and not fpath.is_junction():
                    rescan = True
            if ws and fpath.name in {".gitignore", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"}:
                self.indexer_service.start_indexing(ws.id)
            if ".git" in fpath.parts:
                for project in projects:
                    if Path(project.path) / ".git" in fpath.parents:
                        self.indexer_service.git_service.sync_project_commits(project.id, Path(project.path))
                continue
            # Ignore noise and temp files
            if self._should_ignore(fpath):
                continue

            # Find matching workspace
            if not ws:
                continue

            if change_type == Change.deleted:
                logger.debug("File deleted: %s", fpath)
                self.indexer_service.remove_file(str(fpath))
                self.activity_service.record_activity(
                    activity_type=ActivityType.FILE_DELETED,
                    summary=f"Deleted file {fpath.name}",
                    workspace_id=ws.id,
                    details={"path": str(fpath)},
                )
            elif change_type in (Change.added, Change.modified):
                if fpath.is_file():
                    self.indexer_service.index_single_file(fpath, ws.id, projects_dict)
                    if change_type in (Change.added, Change.modified):
                        act_type = ActivityType.FILE_CREATED if change_type == Change.added else ActivityType.FILE_MODIFIED
                        verb = "Created" if change_type == Change.added else "Modified"
                        self.activity_service.record_activity(
                            activity_type=act_type,
                            summary=f"{verb} {fpath.name}",
                            workspace_id=ws.id,
                            details={"path": str(fpath)},
                        )

        for workspace_id in touched:
            inventory.refresh_totals(workspace_id)
        if rescan:
            # A copied directory can arrive as one event, without child events.
            # Reconcile every membership so overlapping roots also gain children.
            self.indexer_service.start_indexing()

    def _find_workspace_for_path(self, path: Path):
        matches = self._find_workspaces_for_path(path)
        return matches[0] if matches else None

    def _find_workspaces_for_path(self, path: Path):
        matches = []
        for ws in self.workspace_service.list_workspaces():
            if not ws.is_active:
                continue
            try:
                path.relative_to(Path(ws.path))
                matches.append(ws)
            except ValueError:
                pass
        return sorted(matches, key=lambda ws: len(ws.path), reverse=True)

    def _should_ignore(self, path: Path) -> bool:
        name = path.name.lower()
        if (
            name.startswith("~")
            or name.endswith(".tmp")
            or name.endswith(".swp")
            or name.startswith(".#")
            or "node_modules" in path.parts
            or ".git" in path.parts
            or ".venv" in path.parts
            or "__pycache__" in path.parts
        ):
            return True
        return False
