"""Workspace research notes controller."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies import current_user
from app.dtos.note_dto import NoteCreateRequest, NoteResponse, NoteUpdateRequest
from app.models import User
from app.repositories import NoteRepository, WorkspaceRepository
from app.services import NoteService

router = APIRouter(tags=["Workspace notes"])


def get_note_service(session: AsyncSession = Depends(get_session)) -> NoteService:
    note_repo = NoteRepository(session)
    workspace_repo = WorkspaceRepository(session)
    return NoteService(note_repo, workspace_repo)


@router.get("/workspaces/{workspace_id}/notes", response_model=list[NoteResponse])
async def list_workspace_notes(
    workspace_id: uuid.UUID,
    type: str | None = None,
    user: User = Depends(current_user),
    service: NoteService = Depends(get_note_service),
) -> list[NoteResponse]:
    try:
        notes = await service.list_notes(workspace_id, user, note_type=type)
        return [NoteResponse.model_validate(n) for n in notes]
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/workspaces/{workspace_id}/notes", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace_note(
    workspace_id: uuid.UUID,
    payload: NoteCreateRequest,
    user: User = Depends(current_user),
    service: NoteService = Depends(get_note_service),
) -> NoteResponse:
    try:
        note = await service.create_note(
            workspace_id=workspace_id,
            user=user,
            title=payload.title,
            content=payload.content,
            note_type=payload.note_type,
            source_id=payload.source_id,
            source_title=payload.source_title,
            page_number=payload.page_number,
            message_id=payload.message_id,
            citations=payload.citations,
        )
        return NoteResponse.model_validate(note)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/workspaces/{workspace_id}/notes/{note_id}", response_model=NoteResponse)
async def get_workspace_note(
    workspace_id: uuid.UUID,
    note_id: uuid.UUID,
    user: User = Depends(current_user),
    service: NoteService = Depends(get_note_service),
) -> NoteResponse:
    try:
        note = await service.get_note(note_id, workspace_id, user)
        return NoteResponse.model_validate(note)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/workspaces/{workspace_id}/notes/{note_id}", response_model=NoteResponse)
async def update_workspace_note(
    workspace_id: uuid.UUID,
    note_id: uuid.UUID,
    payload: NoteUpdateRequest,
    user: User = Depends(current_user),
    service: NoteService = Depends(get_note_service),
) -> NoteResponse:
    try:
        note = await service.update_note(
            note_id=note_id,
            workspace_id=workspace_id,
            user=user,
            title=payload.title,
            content=payload.content,
            note_type=payload.note_type,
            citations=payload.citations,
        )
        return NoteResponse.model_validate(note)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.delete("/workspaces/{workspace_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_note(
    workspace_id: uuid.UUID,
    note_id: uuid.UUID,
    user: User = Depends(current_user),
    service: NoteService = Depends(get_note_service),
) -> Response:
    try:
        await service.delete_note(note_id, workspace_id, user)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
