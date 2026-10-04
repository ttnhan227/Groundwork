"""Local notes service for developer notes attached to files, projects, and sessions."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from app.database.local_db import LocalDatabase, get_db
from app.models.types import ActivityType, NoteCreate, NoteResponse
from app.services.activity_service import ActivityService

logger = logging.getLogger("groundwork.notes")


class NotesService:
    """Manages searchable Markdown notes in local SQLite."""

    @property
    def db(self) -> LocalDatabase:
        return get_db()

    def __init__(self) -> None:
        self.activity_service = ActivityService()

    def create_note(self, data: NoteCreate) -> NoteResponse:
        conn = self.db.get_connection()
        note_id = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()

        with conn:
            conn.execute("""
            INSERT INTO notes (
                id, title, content, project_id, file_path, tags_json,
                created_at, updated_at, sync_version, sync_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending');
            """, (
                note_id,
                data.title,
                data.content,
                data.project_id,
                data.file_path,
                json.dumps(data.tags),
                now_iso,
                now_iso,
            ))

            # Queue for cloud sync
            conn.execute("""
            INSERT INTO sync_queue (id, entity_type, entity_id, action, payload_json, created_at)
            VALUES (?, 'note', ?, 'upsert', ?, ?);
            """, (
                str(uuid.uuid4()),
                note_id,
                json.dumps({"title": data.title, "content": data.content, "tags": data.tags, "base_version": 0}),
                now_iso,
            ))

        self.activity_service.record_activity(
            activity_type=ActivityType.NOTE_CREATED,
            summary=f"Created note: '{data.title}'",
            project_id=data.project_id,
            details={"note_id": note_id, "file_path": data.file_path},
        )

        return self.get_note(note_id)  # type: ignore

    def list_notes(self, project_id: str | None = None, query: str | None = None, q: str | None = None) -> list[NoteResponse]:
        query = q or query
        conn = self.db.get_connection()
        sql = """
        SELECT n.*, p.name as project_name
        FROM notes n
        LEFT JOIN projects p ON n.project_id = p.id
        """
        conditions = []
        params: list[Any] = []

        if project_id:
            conditions.append("n.project_id = ?")
            params.append(project_id)
        if query:
            conditions.append("(n.title LIKE ? OR n.content LIKE ?)")
            params.extend([f"%{query}%", f"%{query}%"])

        if conditions:
            sql += " WHERE " + " AND ".join(conditions)

        sql += " ORDER BY n.updated_at DESC;"

        rows = conn.execute(sql, params).fetchall()
        result: list[NoteResponse] = []
        for r in rows:
            result.append(NoteResponse(
                id=r["id"],
                title=r["title"],
                content=r["content"],
                project_id=r["project_id"],
                project_name=r["project_name"],
                file_path=r["file_path"],
                tags=json.loads(r["tags_json"]) if r["tags_json"] else [],
                created_at=r["created_at"],
                updated_at=r["updated_at"],
                sync_status=r["sync_status"],
            ))
        return result

    def get_note(self, note_id: str) -> NoteResponse | None:
        conn = self.db.get_connection()
        row = conn.execute("""
            SELECT n.*, p.name as project_name
            FROM notes n
            LEFT JOIN projects p ON n.project_id = p.id
            WHERE n.id = ?;
        """, (note_id,)).fetchone()
        if not row:
            return None

        return NoteResponse(
            id=row["id"],
            title=row["title"],
            content=row["content"],
            project_id=row["project_id"],
            project_name=row["project_name"],
            file_path=row["file_path"],
            tags=json.loads(row["tags_json"]) if row["tags_json"] else [],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            sync_status=row["sync_status"],
        )

    def update_note(self, note_id: str, data: dict[str, Any]) -> NoteResponse | None:
        conn = self.db.get_connection()
        now_iso = datetime.now(timezone.utc).isoformat()
        current = self.get_note(note_id)
        if not current:
            return None

        with conn:
            conn.execute("""
            UPDATE notes SET
                title = COALESCE(?, title),
                content = COALESCE(?, content),
                project_id = ?,
                file_path = ?,
                tags_json = COALESCE(?, tags_json),
                updated_at = ?,
                sync_version = sync_version + 1,
                sync_status = 'pending'
            WHERE id = ?;
            """, (
                data.get("title"),
                data.get("content"),
                data.get("project_id", current.project_id),
                data.get("file_path", current.file_path),
                json.dumps(data["tags"]) if "tags" in data else None,
                now_iso,
                note_id,
            ))

            conn.execute("""
            INSERT INTO sync_queue (id, entity_type, entity_id, action, payload_json, created_at)
            VALUES (?, 'note', ?, 'upsert', ?, ?);
            """, (
                str(uuid.uuid4()),
                note_id,
                json.dumps({"title": self.get_note(note_id).title, "content": self.get_note(note_id).content, "tags": self.get_note(note_id).tags, "base_version": conn.execute("SELECT sync_version FROM notes WHERE id = ?", (note_id,)).fetchone()["sync_version"] - 1}),
                now_iso,
            ))

        return self.get_note(note_id)

    def delete_note(self, note_id: str) -> bool:
        conn = self.db.get_connection()
        now_iso = datetime.now(timezone.utc).isoformat()
        with conn:
            res = conn.execute("DELETE FROM notes WHERE id = ?;", (note_id,))
            if res.rowcount > 0:
                conn.execute("""
                INSERT INTO sync_queue (id, entity_type, entity_id, action, payload_json, created_at)
                VALUES (?, 'note', ?, 'delete', '{}', ?);
                """, (str(uuid.uuid4()), note_id, now_iso))
                return True
        return False
