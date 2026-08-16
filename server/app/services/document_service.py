"""Document ingestion, validation, and metadata business service."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from app.models import Document, User
from app.repositories.document_repository import DocumentRepository


class DocumentService:
    """Business logic for Source Documents, Ingestion, and Metadata."""

    def __init__(self, document_repo: DocumentRepository) -> None:
        self.document_repo = document_repo

    async def list_documents(
        self,
        user: User,
        collection_id: uuid.UUID | None = None,
        workspace_id: uuid.UUID | None = None,
    ) -> Sequence[Document]:
        return await self.document_repo.list_for_user(user, collection_id, workspace_id)

    async def get_document(self, document_id: uuid.UUID, user: User) -> Document:
        doc = await self.document_repo.get_by_id(document_id, user)
        if doc is None:
            raise ValueError("Document not found.")
        return doc

    async def update_metadata(
        self,
        document_id: uuid.UUID,
        user: User,
        display_title: str | None = None,
        tags: list[str] | None = None,
        collection_id: uuid.UUID | None = None,
    ) -> Document:
        doc = await self.get_document(document_id, user)
        if display_title is not None:
            doc.display_title = display_title.strip() or None
        if tags is not None:
            doc.tags = [t.strip() for t in tags if t.strip()]
        if collection_id is not None:
            doc.collection_id = collection_id
        return await self.document_repo.update(doc)

    async def delete_document(self, document_id: uuid.UUID, user: User) -> None:
        doc = await self.get_document(document_id, user)
        await self.document_repo.delete(doc)
