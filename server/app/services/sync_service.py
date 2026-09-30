"""Offline-first synchronization service for Groundwork Sync.

Communicates with the optional GCP backend for lightweight metadata (notes, settings,
saved searches). Local filesystem contents and code are NEVER synchronized to the cloud.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.core.config import get_settings
from app.database.local_db import get_db

logger = logging.getLogger("groundwork.sync")


class SyncService:
    """Manages offline sync queue and exchanges metadata with Groundwork Cloud."""

    def __init__(self) -> None:
        self.db = get_db()
        self.settings = get_settings()

    def get_sync_status(self) -> dict[str, Any]:
        """Returns current sync connectivity and pending queue counts."""
        conn = self.db.get_connection()
        pending_count = conn.execute("SELECT COUNT(*) as count FROM sync_queue;").fetchone()["count"]

        return {
            "enabled": self.settings.cloud_sync_enabled,
            "cloud_url": self.settings.cloud_sync_url,
            "is_authenticated": bool(self.settings.cloud_sync_token),
            "pending_items": pending_count,
            "state": "synced" if pending_count == 0 else "pending",
        }

    def trigger_sync(self) -> dict[str, Any]:
        """Attempts to flush the local sync queue to the cloud backend."""
        if not self.settings.cloud_sync_enabled or not self.settings.cloud_sync_token:
            return {"status": "skipped", "message": "Groundwork Sync is not enabled or authenticated."}

        conn = self.db.get_connection()
        rows = conn.execute("SELECT * FROM sync_queue ORDER BY created_at ASC LIMIT 50;").fetchall()
        if not rows:
            return {"status": "up_to_date", "synced_count": 0}

        items = [
            {
                "queue_id": r["id"],
                "entity_type": r["entity_type"],
                "entity_id": r["entity_id"],
                "action": r["action"],
                "payload": json.loads(r["payload_json"]),
            }
            for r in rows
        ]

        url = f"{self.settings.cloud_sync_url.rstrip('/')}/sync/push"
        headers = {"Authorization": f"Bearer {self.settings.cloud_sync_token}"}

        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, json={"items": items}, headers=headers)
                if resp.status_code == 200:
                    with conn:
                        for item in items:
                            conn.execute("DELETE FROM sync_queue WHERE id = ?;", (item["queue_id"],))
                    return {"status": "success", "synced_count": len(items)}
                else:
                    return {"status": "error", "error": f"Remote returned HTTP {resp.status_code}"}
        except Exception as exc:
            logger.debug("Sync connection failed (device may be offline): %s", exc)
            return {"status": "offline", "message": "Could not connect to cloud sync service. Items remain queued."}

    def get_sync_payload(self) -> dict[str, Any]:
        """Extracts and formats queued metadata payload for inspection or sync.

        Guarantees that files, code chunks, and repositories are never included.
        """
        conn = self.db.get_connection()
        notes = conn.execute("SELECT id, title, tags_json, sync_status FROM notes;").fetchall()
        searches = conn.execute("SELECT id, title, query FROM saved_searches;").fetchall()
        settings_rows = conn.execute("SELECT key, value_json FROM settings_kv;").fetchall()

        return {
            "notes": [dict(n) for n in notes],
            "saved_searches": [dict(s) for s in searches],
            "settings": {r["key"]: r["value_json"] for r in settings_rows},
        }

