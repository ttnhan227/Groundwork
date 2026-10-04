"""Lightweight synchronization router for Groundwork Sync.

Handles push/pull of notes, saved searches, and settings.
Zero code or repository files are ever processed here.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.hosted.core.database import get_db
from app.hosted.models.entities import CloudNote, CloudSavedSearch, CloudSetting, CloudTombstone, SyncReceipt, User
from app.hosted.routers.auth import get_current_user

sync_router = APIRouter(prefix="/sync", tags=["Sync"])


class SyncPushItem(BaseModel):
    queue_id: str = Field(min_length=1, max_length=64)
    entity_type: Literal["note", "saved_search", "setting"]
    entity_id: str = Field(min_length=1, max_length=100)
    action: Literal["upsert", "delete"]
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def bounded_metadata(self):
        allowed = {"note": {"title", "content", "tags", "base_version"}, "saved_search": {"title", "query", "filters"}, "setting": {"key", "value"}}
        if set(self.payload) - allowed[self.entity_type]:
            raise ValueError("Unexpected metadata fields")
        if len(json.dumps(self.payload).encode()) > 256000:
            raise ValueError("Sync item exceeds size limit")
        if self.entity_type == "note":
            if "base_version" in self.payload and (type(self.payload["base_version"]) is not int or self.payload["base_version"] < 0):
                raise ValueError("Invalid note revision")
            if "title" in self.payload and (not isinstance(self.payload["title"], str) or len(self.payload["title"]) > 255):
                raise ValueError("Invalid note title")
            if "content" in self.payload and not isinstance(self.payload["content"], str):
                raise ValueError("Invalid note content")
            if "tags" in self.payload and (not isinstance(self.payload["tags"], list) or any(not isinstance(tag, str) for tag in self.payload["tags"])):
                raise ValueError("Invalid note tags")
        return self


class SyncPushRequest(BaseModel):
    items: list[SyncPushItem] = Field(max_length=50)

    @model_validator(mode="after")
    def unique_queue_ids(self):
        if len({item.queue_id for item in self.items}) != len(self.items):
            raise ValueError("Duplicate queue IDs in batch")
        return self


@sync_router.post("/push")
def push_sync_items(
    req: SyncPushRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    processed = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for item in req.items:
        fingerprint = hashlib.sha256(json.dumps(item.model_dump(exclude={"queue_id"}), sort_keys=True).encode()).hexdigest()
        receipt = db.get(SyncReceipt, (user.id, item.queue_id))
        if receipt:
            if receipt.payload_hash != fingerprint:
                raise HTTPException(status_code=409, detail="Queue item was reused with different contents")
            processed += 1
            continue
        db.add(SyncReceipt(user_id=user.id, queue_id=item.queue_id, payload_hash=fingerprint))
        tombstone = db.get(CloudTombstone, (user.id, item.entity_type, item.entity_id))
        if item.action == "delete":
            if tombstone:
                tombstone.deleted_at = now_iso
            else:
                db.add(CloudTombstone(user_id=user.id, entity_type=item.entity_type, entity_id=item.entity_id, deleted_at=now_iso))
        elif tombstone:
            db.delete(tombstone)
        if item.entity_type == "note":
            note = db.query(CloudNote).filter(
                CloudNote.user_id == user.id,
                CloudNote.client_note_id == item.entity_id,
            ).first()

            if "base_version" in item.payload and item.payload["base_version"] != (note.version if note else 0):
                raise HTTPException(status_code=409, detail="Note revision conflict")
            if item.action == "delete":
                if note:
                    db.delete(note)
            else:  # upsert
                title = item.payload.get("title", note.title if note else "Untitled Note")
                content = item.payload.get("content", note.content if note else "")
                tags = json.dumps(item.payload.get("tags", json.loads(note.tags_json) if note else []))
                if note:
                    note.title = title
                    note.content = content
                    note.tags_json = tags
                    note.version += 1
                    note.updated_at = now_iso
                else:
                    note = CloudNote(
                        user_id=user.id,
                        client_note_id=item.entity_id,
                        title=title,
                        content=content,
                        tags_json=tags,
                        version=1,
                        updated_at=now_iso,
                    )
                    db.add(note)
            processed += 1

        elif item.entity_type == "saved_search":
            search = db.query(CloudSavedSearch).filter(
                CloudSavedSearch.user_id == user.id,
                CloudSavedSearch.client_search_id == item.entity_id,
            ).first()

            if item.action == "delete":
                if search:
                    db.delete(search)
            else:
                title = item.payload.get("title", "")
                query_str = item.payload.get("query", "")
                filters = json.dumps(item.payload.get("filters", {}))
                if search:
                    search.title = title
                    search.query = query_str
                    search.filters_json = filters
                    search.version += 1
                    search.updated_at = now_iso
                else:
                    search = CloudSavedSearch(
                        user_id=user.id,
                        client_search_id=item.entity_id,
                        title=title,
                        query=query_str,
                        filters_json=filters,
                        version=1,
                        updated_at=now_iso,
                    )
                    db.add(search)
            processed += 1

        elif item.entity_type == "setting":
            key = item.payload.get("key", item.entity_id)
            val = json.dumps(item.payload.get("value", {}))
            setting = db.query(CloudSetting).filter(
                CloudSetting.user_id == user.id,
                CloudSetting.key == key,
            ).first()
            if item.action == "delete":
                if setting:
                    db.delete(setting)
                processed += 1
                continue
            if setting:
                setting.value_json = val
                setting.updated_at = now_iso
            else:
                setting = CloudSetting(
                    user_id=user.id,
                    key=key,
                    value_json=val,
                    updated_at=now_iso,
                )
                db.add(setting)
            processed += 1

    db.commit()
    return {"status": "success", "processed_count": processed, "acknowledged_queue_ids": [item.queue_id for item in req.items]}


@sync_router.get("/pull")
def pull_sync_state(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    notes = db.query(CloudNote).filter(CloudNote.user_id == user.id).all()
    searches = db.query(CloudSavedSearch).filter(CloudSavedSearch.user_id == user.id).all()
    settings = db.query(CloudSetting).filter(CloudSetting.user_id == user.id).all()

    return {
        "tombstones": [{"entity_type": t.entity_type, "entity_id": t.entity_id, "deleted_at": t.deleted_at} for t in db.query(CloudTombstone).filter(CloudTombstone.user_id == user.id).all()],
        "notes": [
            {
                "client_id": n.client_note_id,
                "title": n.title,
                "content": n.content,
                "tags": json.loads(n.tags_json) if n.tags_json else [],
                "version": n.version,
                "updated_at": n.updated_at,
            }
            for n in notes
        ],
        "saved_searches": [
            {
                "client_id": s.client_search_id,
                "title": s.title,
                "query": s.query,
                "filters": json.loads(s.filters_json) if s.filters_json else {},
                "version": s.version,
                "updated_at": s.updated_at,
            }
            for s in searches
        ],
        "settings": [
            {
                "key": st.key,
                "value": json.loads(st.value_json) if st.value_json else {},
                "updated_at": st.updated_at,
            }
            for st in settings
        ],
    }
