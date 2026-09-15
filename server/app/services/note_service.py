"""Note business logic and workspace authorization service."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from app.models import Note, User
from app.repositories.note_repository import NoteRepository
from app.repositories.workspace_repository import WorkspaceRepository


class NoteService:
    """Business logic for Workspace Notes."""

    def __init__(
        self,
        note_repo: NoteRepository,
        workspace_repo: WorkspaceRepository,
    ) -> None:
        self.note_repo = note_repo
        self.workspace_repo = workspace_repo

    async def _verify_workspace_access(self, workspace_id: uuid.UUID, user: User) -> None:
        workspace = await self.workspace_repo.get_by_id(workspace_id)
        if workspace is None:
            raise ValueError("Workspace not found.")
        member = await self.workspace_repo.get_member(workspace_id, user.id)
        if member is None and workspace.owner_id != user.id and user.role != "admin":
            raise PermissionError("Access denied to this workspace.")

    async def list_notes(
        self,
        workspace_id: uuid.UUID,
        user: User,
        note_type: str | None = None,
    ) -> Sequence[Note]:
        await self._verify_workspace_access(workspace_id, user)
        return await self.note_repo.list_by_workspace(workspace_id, user.id, note_type)

    async def get_note(
        self,
        note_id: uuid.UUID,
        workspace_id: uuid.UUID,
        user: User,
    ) -> Note:
        await self._verify_workspace_access(workspace_id, user)
        note = await self.note_repo.get_by_id(note_id, workspace_id, user.id)
        if note is None:
            raise ValueError("Note not found.")
        return note

    async def create_note(
        self,
        workspace_id: uuid.UUID,
        user: User,
        title: str,
        content: str = "",
        note_type: str = "user",
        source_id: uuid.UUID | None = None,
        source_title: str | None = None,
        page_number: int | None = None,
        message_id: uuid.UUID | None = None,
        citations: list[dict] | None = None,
    ) -> Note:
        await self._verify_workspace_access(workspace_id, user)
        clean_title = title.strip() or "Untitled Note"
        return await self.note_repo.create(
            workspace_id=workspace_id,
            owner_id=user.id,
            title=clean_title,
            content=content,
            note_type=note_type,
            source_id=source_id,
            source_title=source_title,
            page_number=page_number,
            message_id=message_id,
            citations=citations or [],
        )

    async def update_note(
        self,
        note_id: uuid.UUID,
        workspace_id: uuid.UUID,
        user: User,
        title: str | None = None,
        content: str | None = None,
        note_type: str | None = None,
        citations: list[dict] | None = None,
    ) -> Note:
        note = await self.get_note(note_id, workspace_id, user)
        if title is not None and title.strip():
            note.title = title.strip()
        if content is not None:
            note.content = content
        if note_type is not None:
            note.note_type = note_type
        if citations is not None:
            note.citations = citations
        return await self.note_repo.update(note)

    async def delete_note(
        self,
        note_id: uuid.UUID,
        workspace_id: uuid.UUID,
        user: User,
    ) -> None:
        note = await self.get_note(note_id, workspace_id, user)
        await self.note_repo.delete(note)
