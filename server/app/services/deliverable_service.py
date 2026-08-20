"""Deliverables (Studio Notes/Documents) business logic and export service."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence

from app.models import NativeDocument, NativeDocumentVersion, User
from app.repositories.deliverable_repository import DeliverableRepository
from app.repositories.workspace_repository import WorkspaceRepository


class DeliverableService:
    """Business logic for Studio Notes, Deliverables, Versions, and Exports."""

    def __init__(
        self,
        deliverable_repo: DeliverableRepository,
        workspace_repo: WorkspaceRepository,
    ) -> None:
        self.deliverable_repo = deliverable_repo
        self.workspace_repo = workspace_repo

    async def list_documents(self, workspace_id: uuid.UUID, user: User) -> Sequence[NativeDocument]:
        member = await self.workspace_repo.get_member(workspace_id, user.id)
        if member is None and user.role != "admin":
            raise PermissionError("Access denied to this workspace.")
        return await self.deliverable_repo.list_for_workspace(workspace_id)

    async def get_document(self, document_id: uuid.UUID, user: User) -> NativeDocument:
        doc = await self.deliverable_repo.get_by_id(document_id)
        if doc is None:
            raise ValueError("Document not found.")
        member = await self.workspace_repo.get_member(doc.workspace_id, user.id)
        if member is None and user.role != "admin":
            raise PermissionError("Access denied to this document.")
        return doc

    async def create_document(
        self,
        workspace_id: uuid.UUID,
        user: User,
        title: str,
        content_markdown: str = "",
        blocks: list | None = None,
        source_document_ids: list[uuid.UUID] | None = None,
    ) -> NativeDocument:
        member = await self.workspace_repo.get_member(workspace_id, user.id)
        if member is None and user.role != "admin":
            raise PermissionError("Access denied to this workspace.")

        doc_blocks = blocks or ([{"type": "paragraph", "text": content_markdown}] if content_markdown else [{"type": "paragraph", "text": ""}])
        doc = NativeDocument(
            workspace_id=workspace_id,
            owner_id=user.id,
            title=title.strip() or "Untitled Document",
            content={"type": "doc", "blocks": doc_blocks},
        )
        created = await self.deliverable_repo.create(doc)
        initial_version = NativeDocumentVersion(
            native_document_id=created.id,
            version_number=1,
            title=created.title,
            content=created.content,
            change_summary="Initial document creation",
            created_by=user.id,
        )
        await self.deliverable_repo.add_version(initial_version)
        return created

    async def update_document(
        self,
        document_id: uuid.UUID,
        user: User,
        title: str | None = None,
        content_markdown: str | None = None,
        blocks: list | None = None,
        change_summary: str | None = None,
    ) -> NativeDocument:
        doc = await self.get_document(document_id, user)
        if title is not None:
            doc.title = title.strip() or doc.title
        if blocks is not None:
            doc.content = {"type": "doc", "blocks": blocks}
        elif content_markdown is not None:
            doc.content = {"type": "doc", "blocks": [{"type": "paragraph", "text": content_markdown}]}

        doc.revision += 1
        updated = await self.deliverable_repo.update(doc)
        if change_summary or content_markdown is not None or blocks is not None:
            versions = await self.deliverable_repo.list_versions(document_id)
            next_version = (versions[0].version_number + 1) if versions else doc.revision
            v = NativeDocumentVersion(
                native_document_id=updated.id,
                version_number=next_version,
                title=updated.title,
                content=updated.content,
                change_summary=change_summary or "Saved edit",
                created_by=user.id,
            )
            await self.deliverable_repo.add_version(v)
        return updated

    async def delete_document(self, document_id: uuid.UUID, user: User) -> None:
        doc = await self.get_document(document_id, user)
        await self.deliverable_repo.delete(doc)
