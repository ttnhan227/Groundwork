"""Saved search service for storing and recalling frequent developer queries."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from app.database.local_db import get_db
from app.models.types import SavedSearchCreate, SavedSearchResponse

logger = logging.getLogger("groundwork.saved_searches")


class SavedSearchService:
    """Manages saved search queries in local SQLite."""

    def __init__(self) -> None:
        self.db = get_db()

    def create_saved_search(self, data: SavedSearchCreate) -> SavedSearchResponse:
        conn = self.db.get_connection()
        sid = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()

        with conn:
            conn.execute("""
            INSERT INTO saved_searches (id, title, query, filters_json, created_at, sync_version)
            VALUES (?, ?, ?, ?, ?, 1);
            """, (
                sid,
                data.title,
                data.query,
                json.dumps(data.filters),
                now_iso,
            ))

            conn.execute("""
            INSERT INTO sync_queue (id, entity_type, entity_id, action, payload_json, created_at)
            VALUES (?, 'saved_search', ?, 'upsert', ?, ?);
            """, (
                str(uuid.uuid4()),
                sid,
                json.dumps(data.model_dump()),
                now_iso,
            ))

        return SavedSearchResponse(
            id=sid,
            title=data.title,
            query=data.query,
            filters=data.filters,
            created_at=now_iso,
        )

    def list_saved_searches(self) -> list[SavedSearchResponse]:
        conn = self.db.get_connection()
        rows = conn.execute("SELECT * FROM saved_searches ORDER BY created_at DESC;").fetchall()
        return [
            SavedSearchResponse(
                id=r["id"],
                title=r["title"],
                query=r["query"],
                filters=json.loads(r["filters_json"]) if r["filters_json"] else {},
                created_at=r["created_at"],
            )
            for r in rows
        ]

    def delete_saved_search(self, search_id: str) -> bool:
        conn = self.db.get_connection()
        now_iso = datetime.now(timezone.utc).isoformat()
        with conn:
            res = conn.execute("DELETE FROM saved_searches WHERE id = ?;", (search_id,))
            if res.rowcount > 0:
                conn.execute("""
                INSERT INTO sync_queue (id, entity_type, entity_id, action, payload_json, created_at)
                VALUES (?, 'saved_search', ?, 'delete', '{}', ?);
                """, (str(uuid.uuid4()), search_id, now_iso))
                return True
        return False
