"""Note data repository."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select

from app.models.note import Note
from app.repositories.base import BaseRepository


class NoteRepository(BaseRepository[Note]):
    """Data access operations for workspace research Notes."""

    async def list_by_workspace(
        self,
        workspace_id: uuid.UUID,
        owner_id: uuid.UUID,
        note_type: str | None = None,
    ) -> Sequence[Note]:
        stmt = select(Note).where(
            Note.workspace_id == workspace_id,
            Note.owner_id == owner_id,
        )
        if note_type is not None:
            stmt = stmt.where(Note.note_type == note_type)
        stmt = stmt.order_by(Note.updated_at.desc())
        result = await self.session.scalars(stmt)
        return result.all()

    async def get_by_id(
        self,
        note_id: uuid.UUID,
        workspace_id: uuid.UUID,
        owner_id: uuid.UUID,
    ) -> Note | None:
        stmt = select(Note).where(
            Note.id == note_id,
            Note.workspace_id == workspace_id,
            Note.owner_id == owner_id,
        )
        return await self.session.scalar(stmt)

    async def create(
        self,
        workspace_id: uuid.UUID,
        owner_id: uuid.UUID,
        title: str,
        content: str = "",
        note_type: str = "user",
        source_id: uuid.UUID | None = None,
        source_title: str | None = None,
        page_number: int | None = None,
        message_id: uuid.UUID | None = None,
        citations: list[dict] | None = None,
    ) -> Note:
        note = Note(
            workspace_id=workspace_id,
            owner_id=owner_id,
            title=title.strip() or "Untitled Note",
            content=content,
            note_type=note_type,
            source_id=source_id,
            source_title=source_title,
            page_number=page_number,
            message_id=message_id,
            citations=citations or [],
        )
        self.session.add(note)
        await self.session.commit()
        await self.session.refresh(note)
        return note

    async def update(self, note: Note) -> Note:
        self.session.add(note)
        await self.session.commit()
        await self.session.refresh(note)
        return note

    async def delete(self, note: Note) -> None:
        await self.session.delete(note)
        await self.session.commit()
