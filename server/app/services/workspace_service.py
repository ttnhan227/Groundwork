"""Workspace management service for registering, configuring, and querying local workspaces."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import get_settings
from app.database.local_db import LocalDatabase, get_db
from app.models.types import WorkspaceCreate, WorkspaceResponse

logger = logging.getLogger("groundwork.workspaces")


class WorkspaceService:
    """Manages local workspace folders and their lifecycle."""

    @property
    def db(self) -> LocalDatabase:
        return get_db()

    def __init__(self) -> None:
        self.settings = get_settings()

    def create_workspace(self, data: WorkspaceCreate) -> WorkspaceResponse:
        """Registers a new local workspace folder."""
        path = Path(data.path).resolve()
        if not path.exists():
            raise ValueError(f"Path does not exist: {data.path}")
        if not path.is_dir():
            raise ValueError(f"Path is not a directory: {data.path}")

        ws_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        # Defaults are applied by the indexer, not stored as user privacy rules.
        ignore_patterns = list(dict.fromkeys(data.ignore_patterns))

        conn = self.db.get_connection()
        with conn:
            conn.execute("""
            INSERT INTO workspaces (id, name, path, is_active, ignore_patterns, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?, ?);
            """, (
                ws_id,
                data.name,
                str(path),
                json.dumps(ignore_patterns),
                now,
                now,
            ))

        return WorkspaceResponse(
            id=ws_id,
            name=data.name,
            path=str(path),
            is_active=True,
            ignore_patterns=ignore_patterns,
            created_at=now,
            updated_at=now,
        )

    def list_workspaces(self) -> list[WorkspaceResponse]:
        """Lists all registered workspaces."""
        conn = self.db.get_connection()
        rows = conn.execute("SELECT * FROM workspaces ORDER BY created_at ASC;").fetchall()
        result: list[WorkspaceResponse] = []
        for r in rows:
            result.append(WorkspaceResponse(
                id=r["id"],
                name=r["name"],
                path=r["path"],
                is_active=bool(r["is_active"]),
                ignore_patterns=json.loads(r["ignore_patterns"]) if r["ignore_patterns"] else [],
                created_at=r["created_at"],
                updated_at=r["updated_at"],
            ))
        return result

    def get_workspace(self, workspace_id: str) -> WorkspaceResponse | None:
        """Retrieves a workspace by ID."""
        conn = self.db.get_connection()
        r = conn.execute("SELECT * FROM workspaces WHERE id = ?;", (workspace_id,)).fetchone()
        if not r:
            return None
        return WorkspaceResponse(
            id=r["id"],
            name=r["name"],
            path=r["path"],
            is_active=bool(r["is_active"]),
            ignore_patterns=json.loads(r["ignore_patterns"]) if r["ignore_patterns"] else [],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )

    def delete_workspace(self, workspace_id: str) -> bool:
        """Deletes a workspace and cascades file, chunk, and FTS entries."""
        conn = self.db.get_connection()
        with conn:
            # Clean FTS entries
            conn.execute("""
                DELETE FROM fts_files WHERE file_id IN (
                    SELECT id FROM files WHERE workspace_id = ?
                );
            """, (workspace_id,))
            conn.execute("""
                DELETE FROM fts_chunks WHERE file_id IN (
                    SELECT id FROM files WHERE workspace_id = ?
                );
            """, (workspace_id,))
            res = conn.execute("DELETE FROM workspaces WHERE id = ?;", (workspace_id,))
            return res.rowcount > 0

    def get_allowed_roots(self) -> list[Path]:
        """Returns all registered active workspace paths."""
        conn = self.db.get_connection()
        rows = conn.execute("SELECT path FROM workspaces WHERE is_active = 1;").fetchall()
        return [Path(r["path"]).resolve() for r in rows]
