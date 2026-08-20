"""Deliverables (Studio Notes/Documents, Revisions, Findings) repository."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models import (
    DeliverableRequirement,
    DeliverableReviewFinding,
    NativeDocument,
    NativeDocumentVersion,
)
from app.repositories.base import BaseRepository


class DeliverableRepository(BaseRepository[NativeDocument]):
    """Data access operations for Studio Native Documents, Versions, Requirements, and Findings."""

    async def list_for_workspace(self, workspace_id: uuid.UUID) -> Sequence[NativeDocument]:
        result = await self.session.scalars(
            select(NativeDocument)
            .where(NativeDocument.workspace_id == workspace_id)
            .order_by(NativeDocument.updated_at.desc())
        )
        return result.all()

    async def get_by_id(self, document_id: uuid.UUID) -> NativeDocument | None:
        return await self.session.scalar(
            select(NativeDocument)
            .options(
                selectinload(NativeDocument.sources),
                selectinload(NativeDocument.versions),
            )
            .where(NativeDocument.id == document_id)
        )

    async def create(self, document: NativeDocument) -> NativeDocument:
        self.session.add(document)
        await self.session.commit()
        await self.session.refresh(document)
        return document

    async def update(self, document: NativeDocument) -> NativeDocument:
        self.session.add(document)
        await self.session.commit()
        await self.session.refresh(document)
        return document

    async def delete(self, document: NativeDocument) -> None:
        await self.session.delete(document)
        await self.session.commit()

    async def list_versions(self, document_id: uuid.UUID) -> Sequence[NativeDocumentVersion]:
        result = await self.session.scalars(
            select(NativeDocumentVersion)
            .where(NativeDocumentVersion.native_document_id == document_id)
            .order_by(NativeDocumentVersion.version_number.desc())
        )
        return result.all()

    async def get_version_by_id(self, version_id: uuid.UUID) -> NativeDocumentVersion | None:
        return await self.session.scalar(
            select(NativeDocumentVersion).where(NativeDocumentVersion.id == version_id)
        )

    async def add_version(self, version: NativeDocumentVersion) -> NativeDocumentVersion:
        self.session.add(version)
        await self.session.commit()
        await self.session.refresh(version)
        return version

    async def list_requirements(self, document_id: uuid.UUID) -> Sequence[DeliverableRequirement]:
        result = await self.session.scalars(
            select(DeliverableRequirement)
            .where(DeliverableRequirement.native_document_id == document_id)
            .order_by(DeliverableRequirement.position)
        )
        return result.all()

    async def list_findings(self, document_id: uuid.UUID) -> Sequence[DeliverableReviewFinding]:
        result = await self.session.scalars(
            select(DeliverableReviewFinding)
            .where(DeliverableReviewFinding.native_document_id == document_id)
            .order_by(DeliverableReviewFinding.created_at)
        )
        return result.all()
