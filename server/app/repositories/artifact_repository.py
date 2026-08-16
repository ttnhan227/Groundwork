"""Generated artifacts repository."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select

from app.models import ArtifactVersion, GeneratedArtifact, User
from app.repositories.base import BaseRepository


class ArtifactRepository(BaseRepository[GeneratedArtifact]):
    """Data access operations for Generated Artifacts and Versions."""

    async def get_by_id(self, artifact_id: uuid.UUID) -> GeneratedArtifact | None:
        return await self.session.scalar(
            select(GeneratedArtifact).where(GeneratedArtifact.id == artifact_id)
        )

    async def list_for_user(self, user: User) -> Sequence[GeneratedArtifact]:
        result = await self.session.scalars(
            select(GeneratedArtifact)
            .where(GeneratedArtifact.owner_id == user.id)
            .order_by(GeneratedArtifact.created_at.desc())
        )
        return result.all()

    async def create(self, artifact: GeneratedArtifact) -> GeneratedArtifact:
        self.session.add(artifact)
        await self.session.commit()
        await self.session.refresh(artifact)
        return artifact

    async def update(self, artifact: GeneratedArtifact) -> GeneratedArtifact:
        self.session.add(artifact)
        await self.session.commit()
        await self.session.refresh(artifact)
        return artifact

    async def delete(self, artifact: GeneratedArtifact) -> None:
        await self.session.delete(artifact)
        await self.session.commit()

    async def list_versions(self, artifact_id: uuid.UUID) -> Sequence[ArtifactVersion]:
        result = await self.session.scalars(
            select(ArtifactVersion)
            .where(ArtifactVersion.artifact_id == artifact_id)
            .order_by(ArtifactVersion.version_number.desc())
        )
        return result.all()
