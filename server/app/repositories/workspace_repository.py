"""Workspace (Notebook project) data repository."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select

from app.models import User, Workspace, WorkspaceMember
from app.repositories.base import BaseRepository


class WorkspaceRepository(BaseRepository[Workspace]):
    """Data access operations for Workspaces and Members."""

    async def list_for_user(self, user: User) -> Sequence[Workspace]:
        result = await self.session.scalars(
            select(Workspace)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .where(WorkspaceMember.user_id == user.id)
            .order_by(Workspace.created_at.desc())
        )
        return result.all()

    async def get_by_id(self, workspace_id: uuid.UUID) -> Workspace | None:
        return await self.session.scalar(
            select(Workspace).where(Workspace.id == workspace_id)
        )

    async def create(self, owner_id: uuid.UUID, name: str, kind: str = "personal") -> Workspace:
        workspace = Workspace(owner_id=owner_id, name=name, kind=kind)
        self.session.add(workspace)
        await self.session.flush()
        member = WorkspaceMember(workspace_id=workspace.id, user_id=owner_id, role="owner")
        self.session.add(member)
        await self.session.commit()
        await self.session.refresh(workspace)
        return workspace

    async def update(self, workspace: Workspace) -> Workspace:
        self.session.add(workspace)
        await self.session.commit()
        await self.session.refresh(workspace)
        return workspace

    async def delete(self, workspace: Workspace) -> None:
        await self.session.delete(workspace)
        await self.session.commit()

    async def get_member(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> WorkspaceMember | None:
        return await self.session.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        )

    async def ensure_personal_workspace(self, user: User) -> Workspace:
        workspace = await self.session.scalar(
            select(Workspace).where(Workspace.owner_id == user.id).order_by(Workspace.created_at)
        )
        if workspace is not None:
            return workspace
        return await self.create(owner_id=user.id, name=f"{user.display_name}'s workspace", kind="personal")
