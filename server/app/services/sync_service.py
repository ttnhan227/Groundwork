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
            "state": "disabled" if not self.settings.cloud_sync_enabled else ("synced" if pending_count == 0 else "pending"),
        }

    def trigger_sync(self) -> dict[str, Any]:
        """Attempts to flush the local sync queue to the cloud backend."""
        if not self.settings.cloud_sync_enabled or not self.settings.cloud_sync_token:
            return {"status": "skipped", "message": "Groundwork Sync is not enabled or authenticated."}

        conn = self.db.get_connection()
        rows = conn.execute("SELECT * FROM sync_queue ORDER BY created_at ASC LIMIT 50;").fetchall()
        if not rows:
            return self.pull_remote_state()

        items = [
            {
                "queue_id": r["id"],
                "entity_type": r["entity_type"],
                "entity_id": r["entity_id"],
                "action": r["action"],
                "payload": {k: v for k, v in json.loads(r["payload_json"]).items() if k in {"note": {"title", "content", "tags", "base_version"}, "saved_search": {"title", "query", "filters"}, "setting": {"key", "value"}}.get(r["entity_type"], set())},
            }
            for r in rows
        ]

        url = f"{self.settings.cloud_sync_url.rstrip('/')}/sync/push"
        headers = {"Authorization": f"Bearer {self.settings.cloud_sync_token}"}

        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, json={"items": items}, headers=headers)
                if resp.status_code == 200:
                    acknowledged = set(resp.json().get("acknowledged_queue_ids", []))
                    if not acknowledged:
                        return {"status": "error", "error": "Cloud did not acknowledge queued items; queue retained."}
                    with conn:
                        for item in items:
                            if item["queue_id"] not in acknowledged:
                                continue
                            if item["entity_type"] == "note" and item["action"] == "upsert":
                                conn.execute("UPDATE notes SET sync_status = 'synced' WHERE id = ? AND NOT EXISTS (SELECT 1 FROM sync_queue WHERE entity_id = ? AND id != ?);", (item["entity_id"], item["entity_id"], item["queue_id"]))
                            conn.execute("DELETE FROM sync_queue WHERE id = ?;", (item["queue_id"],))
                    pull = self.pull_remote_state()
                    return {"status": "success", "synced_count": len(acknowledged.intersection(item["queue_id"] for item in items)), "pull": pull}
                else:
                    return {"status": "conflict" if resp.status_code == 409 else "error", "error": "Cloud contains a newer revision. Local changes remain queued." if resp.status_code == 409 else f"Remote returned HTTP {resp.status_code}"}
        except Exception as exc:
            logger.debug("Sync connection failed (device may be offline): %s", exc)
            return {"status": "offline", "message": "Could not connect to cloud sync service. Items remain queued."}

    def pull_remote_state(self) -> dict[str, Any]:
        """Merge cloud metadata, preserving unsent local edits and local path links."""
        if not self.settings.cloud_sync_enabled or not self.settings.cloud_sync_token:
            return {"status": "skipped"}
        try:
            with httpx.Client(timeout=10.0) as client:
                response = client.get(f"{self.settings.cloud_sync_url.rstrip('/')}/sync/pull", headers={"Authorization": f"Bearer {self.settings.cloud_sync_token}"})
                response.raise_for_status()
                state = response.json()
            conn = self.db.get_connection()
            pending = {(r["entity_type"], r["entity_id"]) for r in conn.execute("SELECT entity_type, entity_id FROM sync_queue")}
            conflicts = []
            applied = 0
            with conn:
                for note in state.get("notes", []):
                    note_id = note["client_id"]
                    if ("note", note_id) in pending:
                        conflicts.append(note_id)
                        continue
                    current = conn.execute("SELECT updated_at FROM notes WHERE id = ?", (note_id,)).fetchone()
                    if current and current["updated_at"] > note["updated_at"]:
                        continue
                    conn.execute("""INSERT INTO notes (id, title, content, tags_json, created_at, updated_at, sync_version, sync_status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'synced')
                        ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, tags_json=excluded.tags_json,
                        updated_at=excluded.updated_at, sync_version=excluded.sync_version, sync_status='synced'""",
                        (note_id, note["title"], note["content"], json.dumps(note.get("tags", [])), note["updated_at"], note["updated_at"], note["version"]))
                    applied += 1
                for search in state.get("saved_searches", []):
                    sid = search["client_id"]
                    if ("saved_search", sid) in pending:
                        conflicts.append(sid)
                        continue
                    conn.execute("""INSERT INTO saved_searches (id, title, query, filters_json, created_at, sync_version)
                        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, query=excluded.query,
                        filters_json=excluded.filters_json, sync_version=excluded.sync_version""",
                        (sid, search["title"], search["query"], json.dumps(search.get("filters", {})), search["updated_at"], search["version"]))
                    applied += 1
                for setting in state.get("settings", []):
                    # Never apply cloud credentials, paths, or provider settings locally.
                    if setting["key"] not in {"theme", "language"} or ("setting", setting["key"]) in pending:
                        continue
                    conn.execute("INSERT INTO settings_kv (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at", (setting["key"], json.dumps(setting["value"]), setting["updated_at"]))
                for item in state.get("tombstones", []):
                    key = (item["entity_type"], item["entity_id"])
                    if key in pending:
                        conflicts.append(item["entity_id"])
                        continue
                    if item["entity_type"] == "note":
                        conn.execute("DELETE FROM notes WHERE id = ? AND updated_at <= ?", (item["entity_id"], item["deleted_at"]))
                    elif item["entity_type"] == "saved_search":
                        conn.execute("DELETE FROM saved_searches WHERE id = ?", (item["entity_id"],))
                    elif item["entity_type"] == "setting" and item["entity_id"] in {"theme", "language"}:
                        conn.execute("DELETE FROM settings_kv WHERE key = ?", (item["entity_id"],))
            return {"status": "pulled", "applied_count": applied, "conflicts": conflicts}
        except Exception:
            return {"status": "offline", "message": "Pull failed; local metadata remains available."}

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

