"""Background processing jobs repository."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select

from app.models import ProcessingJob, User
from app.repositories.base import BaseRepository


class JobRepository(BaseRepository[ProcessingJob]):
    """Data access operations for Background Processing Jobs."""

    async def get_by_id(self, job_id: uuid.UUID) -> ProcessingJob | None:
        return await self.session.scalar(
            select(ProcessingJob).where(ProcessingJob.id == job_id)
        )

    async def list_for_user(self, user: User, limit: int = 50) -> Sequence[ProcessingJob]:
        result = await self.session.scalars(
            select(ProcessingJob)
            .where(ProcessingJob.user_id == user.id)
            .order_by(ProcessingJob.created_at.desc())
            .limit(limit)
        )
        return result.all()

    async def create(self, job: ProcessingJob) -> ProcessingJob:
        self.session.add(job)
        await self.session.commit()
        await self.session.refresh(job)
        return job

    async def update(self, job: ProcessingJob) -> ProcessingJob:
        self.session.add(job)
        await self.session.commit()
        await self.session.refresh(job)
        return job
