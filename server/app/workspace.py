import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.chat import owned_conversation
from app.database import get_session
from app.dependencies import current_user
from app.models import ConversationResource, Document, GeneratedArtifact, User, WorkspaceMemory
from app.schemas import (
    ConversationResourceCreate,
    ConversationResourceResponse,
    WorkspaceMemoryResponse,
    WorkspaceMemoryUpsert,
)

router = APIRouter(tags=["AI workspace memory and resources"])


@router.get("/conversations/{conversation_id}/resources", response_model=list[ConversationResourceResponse])
async def list_resources(
    conversation_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ConversationResource]:
    await owned_conversation(conversation_id, user, session)
    return list(await session.scalars(
        select(ConversationResource)
        .where(ConversationResource.conversation_id == conversation_id)
        .order_by(ConversationResource.created_at)
    ))


@router.post("/conversations/{conversation_id}/resources", response_model=ConversationResourceResponse, status_code=status.HTTP_201_CREATED)
async def attach_resource(
    conversation_id: uuid.UUID,
    payload: ConversationResourceCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ConversationResource:
    await owned_conversation(conversation_id, user, session)
    model = Document if payload.resource_type == "document" else GeneratedArtifact
    resource = await session.scalar(
        select(model).where(model.id == payload.resource_id, model.owner_id == user.id)
    )
    if resource is None:
        raise HTTPException(status_code=404, detail="Workspace resource not found")
    existing = await session.scalar(
        select(ConversationResource).where(
            ConversationResource.conversation_id == conversation_id,
            ConversationResource.resource_type == payload.resource_type,
            ConversationResource.resource_id == payload.resource_id,
        )
    )
    if existing:
        return existing
    reference = ConversationResource(
        conversation_id=conversation_id,
        resource_type=payload.resource_type,
        resource_id=payload.resource_id,
        role=payload.role,
    )
    session.add(reference)
    await session.commit()
    await session.refresh(reference)
    return reference


@router.delete("/conversations/{conversation_id}/resources/{resource_id}", status_code=204)
async def detach_resource(
    conversation_id: uuid.UUID,
    resource_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await owned_conversation(conversation_id, user, session)
    reference = await session.scalar(
        select(ConversationResource).where(
            ConversationResource.conversation_id == conversation_id,
            ConversationResource.resource_id == resource_id,
        )
    )
    if reference is None:
        raise HTTPException(status_code=404, detail="Conversation resource not found")
    await session.delete(reference)
    await session.commit()
    return Response(status_code=204)


@router.get("/workspace/memory", response_model=list[WorkspaceMemoryResponse])
async def list_memory(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[WorkspaceMemory]:
    return list(await session.scalars(
        select(WorkspaceMemory).where(WorkspaceMemory.owner_id == user.id).order_by(WorkspaceMemory.key)
    ))


@router.put("/workspace/memory/{key}", response_model=WorkspaceMemoryResponse)
async def upsert_memory(
    key: str,
    payload: WorkspaceMemoryUpsert,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceMemory:
    clean_key = key.strip().lower().replace(" ", "_")
    if not clean_key or len(clean_key) > 80:
        raise HTTPException(status_code=422, detail="Invalid memory key")
    memory = await session.scalar(
        select(WorkspaceMemory).where(
            WorkspaceMemory.owner_id == user.id,
            WorkspaceMemory.key == clean_key,
        )
    )
    if memory is None:
        memory = WorkspaceMemory(owner_id=user.id, key=clean_key, value=payload.value)
        session.add(memory)
    else:
        memory.value = payload.value
    await session.commit()
    await session.refresh(memory)
    return memory


@router.delete("/workspace/memory/{key}", status_code=204)
async def remove_memory(
    key: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    memory = await session.scalar(
        select(WorkspaceMemory).where(
            WorkspaceMemory.owner_id == user.id,
            WorkspaceMemory.key == key,
        )
    )
    if memory is None:
        raise HTTPException(status_code=404, detail="Memory not found")
    await session.delete(memory)
    await session.commit()
    return Response(status_code=204)
