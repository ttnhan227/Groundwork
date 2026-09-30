"""Context session service ("Continue Where I Left Off").

Maintains persistent developer working memory:
- Active project
- Inspected files
- Relevant Git commits
- Working notes and TODOs
- Last executed commands
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from app.database.local_db import LocalDatabase, get_db
from app.models.types import ActivityType, ContextSessionCreate, ContextSessionResponse
from app.services.activity_service import ActivityService

logger = logging.getLogger("groundwork.context")


class ContextService:
    """Manages persistent context sessions for resuming unfinished work."""

    @property
    def db(self) -> LocalDatabase:
        return get_db()

    def __init__(self) -> None:
        self.activity_service = ActivityService()

    def create_session(self, data: ContextSessionCreate) -> ContextSessionResponse:
        conn = self.db.get_connection()
        sess_id = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()

        with conn:
            conn.execute("""
            INSERT INTO context_sessions (
                id, title, project_id, status, started_at, last_active_at,
                files_inspected_json, git_commits_json, notes_json, todos_json,
                last_command, summary
            ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?);
            """, (
                sess_id,
                data.title,
                data.project_id,
                now_iso,
                now_iso,
                json.dumps(data.files_inspected),
                json.dumps(data.git_commits),
                json.dumps(data.notes),
                json.dumps(data.todos),
                data.last_command,
                data.summary,
            ))

        self.activity_service.record_activity(
            activity_type=ActivityType.INVESTIGATION_STARTED,
            summary=f"Started working on session: {data.title}",
            project_id=data.project_id,
            details={"session_id": sess_id},
        )

        return self.get_session(sess_id)  # type: ignore

    def list_sessions(self, project_id: str | None = None) -> list[ContextSessionResponse]:
        conn = self.db.get_connection()
        query = """
        SELECT s.*, p.name as project_name
        FROM context_sessions s
        LEFT JOIN projects p ON s.project_id = p.id
        """
        params: list[Any] = []
        if project_id:
            query += " WHERE s.project_id = ?"
            params.append(project_id)
        query += " ORDER BY s.last_active_at DESC;"

        rows = conn.execute(query, params).fetchall()
        result: list[ContextSessionResponse] = []
        for r in rows:
            result.append(ContextSessionResponse(
                id=r["id"],
                title=r["title"],
                project_id=r["project_id"],
                project_name=r["project_name"],
                status=r["status"],
                started_at=r["started_at"],
                last_active_at=r["last_active_at"],
                files_inspected=json.loads(r["files_inspected_json"]) if r["files_inspected_json"] else [],
                git_commits=json.loads(r["git_commits_json"]) if r["git_commits_json"] else [],
                notes=json.loads(r["notes_json"]) if r["notes_json"] else [],
                todos=json.loads(r["todos_json"]) if r["todos_json"] else [],
                last_command=r["last_command"],
                summary=r["summary"],
            ))
        return result

    def get_session(self, session_id: str) -> ContextSessionResponse | None:
        conn = self.db.get_connection()
        row = conn.execute("""
            SELECT s.*, p.name as project_name
            FROM context_sessions s
            LEFT JOIN projects p ON s.project_id = p.id
            WHERE s.id = ?;
        """, (session_id,)).fetchone()
        if not row:
            return None

        return ContextSessionResponse(
            id=row["id"],
            title=row["title"],
            project_id=row["project_id"],
            project_name=row["project_name"],
            status=row["status"],
            started_at=row["started_at"],
            last_active_at=row["last_active_at"],
            files_inspected=json.loads(row["files_inspected_json"]) if row["files_inspected_json"] else [],
            git_commits=json.loads(row["git_commits_json"]) if row["git_commits_json"] else [],
            notes=json.loads(row["notes_json"]) if row["notes_json"] else [],
            todos=json.loads(row["todos_json"]) if row["todos_json"] else [],
            last_command=row["last_command"],
            summary=row["summary"],
        )

    def update_session(self, session_id: str, updates: dict[str, Any]) -> ContextSessionResponse | None:
        conn = self.db.get_connection()
        now_iso = datetime.now(timezone.utc).isoformat()
        current = self.get_session(session_id)
        if not current:
            return None

        fields = ["last_active_at = ?"]
        params = [now_iso]

        if "title" in updates:
            fields.append("title = ?")
            params.append(updates["title"])
        if "status" in updates:
            fields.append("status = ?")
            params.append(updates["status"])
        if "summary" in updates:
            fields.append("summary = ?")
            params.append(updates["summary"])
        if "last_command" in updates:
            fields.append("last_command = ?")
            params.append(updates["last_command"])
        if "files_inspected" in updates:
            fields.append("files_inspected_json = ?")
            params.append(json.dumps(updates["files_inspected"]))
        if "git_commits" in updates:
            fields.append("git_commits_json = ?")
            params.append(json.dumps(updates["git_commits"]))
        if "notes" in updates:
            fields.append("notes_json = ?")
            params.append(json.dumps(updates["notes"]))
        if "todos" in updates:
            fields.append("todos_json = ?")
            params.append(json.dumps(updates["todos"]))

        params.append(session_id)
        sql = f"UPDATE context_sessions SET {', '.join(fields)} WHERE id = ?;"

        with conn:
            conn.execute(sql, params)

        return self.get_session(session_id)
