"""Workspace lifecycle and authorization service."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from app.models import User, Workspace
from app.repositories.workspace_repository import WorkspaceRepository


class WorkspaceService:
    """Business logic for Workspace management."""

    def __init__(self, workspace_repo: WorkspaceRepository) -> None:
        self.workspace_repo = workspace_repo

    async def list_workspaces(self, user: User) -> Sequence[Workspace]:
        await self.workspace_repo.ensure_personal_workspace(user)
        return await self.workspace_repo.list_for_user(user)

    async def get_workspace(self, workspace_id: uuid.UUID, user: User) -> Workspace:
        workspace = await self.workspace_repo.get_by_id(workspace_id)
        if workspace is None:
            raise ValueError("Workspace not found.")
        member = await self.workspace_repo.get_member(workspace_id, user.id)
        if member is None and workspace.owner_id != user.id and user.role != "admin":
            raise PermissionError("Access denied to this workspace.")
        return workspace

    async def create_workspace(self, user: User, name: str, kind: str = "personal") -> Workspace:
        clean_name = name.strip()
        if not clean_name:
            clean_name = "Untitled Workspace"
        return await self.workspace_repo.create(owner_id=user.id, name=clean_name, kind=kind)

    async def update_workspace(self, workspace_id: uuid.UUID, user: User, name: str | None = None) -> Workspace:
        workspace = await self.get_workspace(workspace_id, user)
        if name is not None and name.strip():
            workspace.name = name.strip()
        return await self.workspace_repo.update(workspace)

    async def delete_workspace(self, workspace_id: uuid.UUID, user: User) -> None:
        workspace = await self.get_workspace(workspace_id, user)
        await self.workspace_repo.delete(workspace)

    # Backward-compatibility aliases
    list_notebooks = list_workspaces
    get_notebook = get_workspace
    create_notebook = create_workspace
    update_notebook = update_workspace
    delete_notebook = delete_workspace
