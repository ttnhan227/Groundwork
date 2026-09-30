"""Lightweight synchronization router for Groundwork Sync.

Handles push/pull of notes, saved searches, and settings.
Zero code or repository files are ever processed here.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import CloudNote, CloudSavedSearch, CloudSetting, User
from app.routers.auth import get_current_user

sync_router = APIRouter(prefix="/sync", tags=["Sync"])


class SyncPushItem(BaseModel):
    queue_id: str
    entity_type: str  # note, saved_search, setting
    entity_id: str
    action: str  # upsert, delete
    payload: dict[str, Any] = Field(default_factory=dict)


class SyncPushRequest(BaseModel):
    items: list[SyncPushItem]


@sync_router.post("/push")
def push_sync_items(
    req: SyncPushRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    processed = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for item in req.items:
        if item.entity_type == "note":
            note = db.query(CloudNote).filter(
                CloudNote.user_id == user.id,
                CloudNote.client_note_id == item.entity_id,
            ).first()

            if item.action == "delete":
                if note:
                    db.delete(note)
            else:  # upsert
                title = item.payload.get("title", "Untitled Note")
                content = item.payload.get("content", "")
                tags = json.dumps(item.payload.get("tags", []))
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
    return {"status": "success", "processed_count": processed}


@sync_router.get("/pull")
def pull_sync_state(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    notes = db.query(CloudNote).filter(CloudNote.user_id == user.id).all()
    searches = db.query(CloudSavedSearch).filter(CloudSavedSearch.user_id == user.id).all()
    settings = db.query(CloudSetting).filter(CloudSetting.user_id == user.id).all()

    return {
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
