"""PDF Tools and document processing business logic service."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from app.models import GeneratedArtifact, User
from app.repositories.artifact_repository import ArtifactRepository


class PdfService:
    """High-level service coordinating PDF manipulation tools and artifact persistence."""

    def __init__(self, artifact_repo: ArtifactRepository) -> None:
        self.artifact_repo = artifact_repo

    async def list_artifacts(self, user: User) -> Sequence[GeneratedArtifact]:
        return await self.artifact_repo.list_for_user(user)

    async def get_artifact(self, artifact_id: uuid.UUID, user: User) -> GeneratedArtifact:
        artifact = await self.artifact_repo.get_by_id(artifact_id)
        if artifact is None or (artifact.owner_id != user.id and user.role != "admin"):
            raise ValueError("Artifact not found.")
        return artifact

    async def delete_artifact(self, artifact_id: uuid.UUID, user: User) -> None:
        artifact = await self.get_artifact(artifact_id, user)
        await self.artifact_repo.delete(artifact)
