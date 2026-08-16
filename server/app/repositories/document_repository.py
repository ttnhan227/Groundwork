"""Document data repository for uploaded source PDFs and assets."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models import Document, DocumentChunk, DocumentPage, User
from app.repositories.base import BaseRepository


class DocumentRepository(BaseRepository[Document]):
    """Data access operations for Document and related Pages/Chunks."""

    async def list_for_user(
        self,
        user: User,
        collection_id: uuid.UUID | None = None,
        workspace_id: uuid.UUID | None = None,
    ) -> Sequence[Document]:
        query = select(Document).where(Document.owner_id == user.id)
        if collection_id is not None:
            query = query.where(Document.collection_id == collection_id)
        if workspace_id is not None:
            query = query.where(Document.workspace_id == workspace_id)
        query = query.order_by(Document.created_at.desc())
        result = await self.session.scalars(query)
        return result.all()

    async def get_by_id(self, document_id: uuid.UUID, user: User | None = None) -> Document | None:
        query = select(Document).where(Document.id == document_id)
        if user is not None:
            query = query.where(Document.owner_id == user.id)
        return await self.session.scalar(query)

    async def get_by_id_with_pages(self, document_id: uuid.UUID) -> Document | None:
        return await self.session.scalar(
            select(Document)
            .options(selectinload(Document.pages))
            .where(Document.id == document_id)
        )

    async def create(self, document: Document) -> Document:
        self.session.add(document)
        await self.session.commit()
        await self.session.refresh(document)
        return document

    async def update(self, document: Document) -> Document:
        self.session.add(document)
        await self.session.commit()
        await self.session.refresh(document)
        return document

    async def delete(self, document: Document) -> None:
        await self.session.delete(document)
        await self.session.commit()

    async def get_pages(self, document_id: uuid.UUID) -> Sequence[DocumentPage]:
        result = await self.session.scalars(
            select(DocumentPage)
            .where(DocumentPage.document_id == document_id)
            .order_by(DocumentPage.page_number)
        )
        return result.all()

    async def get_chunks(self, document_id: uuid.UUID) -> Sequence[DocumentChunk]:
        result = await self.session.scalars(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == document_id)
            .order_by(DocumentChunk.chunk_index)
        )
        return result.all()
