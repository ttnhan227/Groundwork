"""Activity tracking and timeline service.

Answers:
- "What was I working on yesterday?"
- "What files were modified recently?"
- "What Git commits occurred across my workspace?"
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.database.local_db import LocalDatabase, get_db
from app.models.types import ActivityItem, ActivityType

logger = logging.getLogger("groundwork.activity")


class ActivityService:
    """Records and aggregates local workspace timeline activities."""

    @property
    def db(self) -> LocalDatabase:
        return get_db()

    def record_activity(
        self,
        activity_type: ActivityType,
        summary: str,
        workspace_id: str | None = None,
        project_id: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> ActivityItem:
        """Records a new observed activity in SQLite."""
        act_id = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        details = details or {}

        conn = self.db.get_connection()
        with conn:
            conn.execute("""
            INSERT INTO activities (id, workspace_id, project_id, activity_type, summary, details_json, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            """, (
                act_id,
                workspace_id,
                project_id,
                activity_type.value,
                summary,
                json.dumps(details),
                now_iso,
            ))

        return ActivityItem(
            id=act_id,
            workspace_id=workspace_id,
            project_id=project_id,
            activity_type=activity_type,
            summary=summary,
            details=details,
            timestamp=now_iso,
        )

    def list_activities(
        self,
        project_id: str | None = None,
        days: int = 7,
        limit: int = 100,
    ) -> list[ActivityItem]:
        """Lists chronological workspace activities."""
        conn = self.db.get_connection()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        query = """
        SELECT a.*, p.name as project_name
        FROM activities a
        LEFT JOIN projects p ON a.project_id = p.id
        WHERE a.timestamp >= ?
        """
        params: list[Any] = [cutoff]

        if project_id:
            query += " AND a.project_id = ?"
            params.append(project_id)

        query += " ORDER BY a.timestamp DESC LIMIT ?;"
        params.append(limit)

        rows = conn.execute(query, params).fetchall()
        result: list[ActivityItem] = []
        for r in rows:
            result.append(ActivityItem(
                id=r["id"],
                workspace_id=r["workspace_id"],
                project_id=r["project_id"],
                project_name=r["project_name"],
                activity_type=ActivityType(r["activity_type"]),
                summary=r["summary"],
                details=json.loads(r["details_json"]) if r["details_json"] else {},
                timestamp=r["timestamp"],
            ))
        return result

    def get_what_was_i_doing_summary(self, days: int = 2) -> dict[str, Any]:
        """Collects evidence across files, git, notes, and sessions to summarize recent work."""
        conn = self.db.get_connection()
        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=days)
        cutoff_iso = cutoff_dt.isoformat()
        cutoff_ts = cutoff_dt.timestamp()

        # 1. Recently modified files
        file_rows = conn.execute("""
            SELECT f.filename, f.relative_path, f.mtime, p.name as project_name
            FROM files f
            LEFT JOIN projects p ON f.project_id = p.id
            WHERE f.mtime >= ?
            ORDER BY f.mtime DESC LIMIT 20;
        """, (cutoff_ts,)).fetchall()

        modified_files = [
            {
                "filename": r["filename"],
                "path": r["relative_path"],
                "project": r["project_name"] or "Workspace",
                "mtime": datetime.fromtimestamp(r["mtime"], tz=timezone.utc).strftime("%Y-%m-%d %H:%M"),
            }
            for r in file_rows
        ]

        # 2. Recent Git commits
        commit_rows = conn.execute("""
            SELECT c.commit_hash, c.author, c.date, c.message, p.name as project_name
            FROM git_commits c
            JOIN projects p ON c.project_id = p.id
            WHERE c.date >= ?
            ORDER BY c.date DESC LIMIT 15;
        """, (cutoff_iso,)).fetchall()

        recent_commits = [
            {
                "hash": r["commit_hash"][:7],
                "author": r["author"],
                "date": r["date"],
                "message": r["message"],
                "project": r["project_name"],
            }
            for r in commit_rows
        ]

        # 3. Recent notes
        note_rows = conn.execute("""
            SELECT n.title, n.content, n.created_at, p.name as project_name
            FROM notes n
            LEFT JOIN projects p ON n.project_id = p.id
            WHERE n.updated_at >= ?
            ORDER BY n.updated_at DESC LIMIT 10;
        """, (cutoff_iso,)).fetchall()

        recent_notes = [
            {"title": r["title"], "snippet": r["content"][:100], "project": r["project_name"]}
            for r in note_rows
        ]

        # 4. Context sessions active
        session_rows = conn.execute("""
            SELECT s.title, s.status, s.last_active_at, p.name as project_name
            FROM context_sessions s
            LEFT JOIN projects p ON s.project_id = p.id
            WHERE s.last_active_at >= ?
            ORDER BY s.last_active_at DESC LIMIT 5;
        """, (cutoff_iso,)).fetchall()

        active_sessions = [
            {"title": r["title"], "status": r["status"], "project": r["project_name"]}
            for r in session_rows
        ]

        # Build natural summary
        projects_active = list(set(
            [f["project"] for f in modified_files if f["project"]] +
            [c["project"] for c in recent_commits if c["project"]]
        ))

        summary_lines = []
        if projects_active:
            summary_lines.append(f"You were primarily active in: {', '.join(projects_active)}.")
        if recent_commits:
            summary_lines.append(f"You made {len(recent_commits)} Git commits, including '{recent_commits[0]['message']}'.")
        if modified_files:
            summary_lines.append(f"You modified {len(modified_files)} files recently (most recent: {modified_files[0]['filename']}).")
        if active_sessions:
            summary_lines.append(f"Active context session: '{active_sessions[0]['title']}'.")

        concise_summary = " ".join(summary_lines) if summary_lines else "No major activity observed in this timeframe."

        return {
            "period_days": days,
            "concise_summary": concise_summary,
            "active_projects": projects_active,
            "modified_files": modified_files,
            "recent_commits": recent_commits,
            "recent_notes": recent_notes,
            "active_sessions": active_sessions,
        }
