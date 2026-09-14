import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies import current_user
from app.documents import owned_document
from app.models import Collection, Document, User
from app.schemas import (
    CollectionCreate,
    CollectionResponse,
    CollectionUpdate,
    DocumentMetadataUpdate,
    DocumentResponse,
)

router = APIRouter(tags=["Version 2.5 workspace"])


async def owned_collection(identifier: uuid.UUID, user: User, session: AsyncSession) -> Collection:
    collection = await session.scalar(
        select(Collection).where(Collection.id == identifier, Collection.owner_id == user.id)
    )
    if collection is None:
        raise HTTPException(status_code=404, detail="Collection not found")
    return collection


@router.get("/collections", response_model=list[CollectionResponse])
async def list_collections(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> list[Collection]:
    return list(
        await session.scalars(select(Collection).where(Collection.owner_id == user.id).order_by(Collection.name))
    )


@router.post("/collections", response_model=CollectionResponse, status_code=status.HTTP_201_CREATED)
async def create_collection(
    payload: CollectionCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Collection:
    # Validate required field 'name' first
    if not isinstance(payload.name, str):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Field 'name' must be a string")

    if not payload.name or not payload.name.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Field 'name' is required")

    # Validate name length to prevent oversized inputs
    if len(payload.name) > 255:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Field 'name' must be 255 characters or less"
        )

    # Validate 'color' field is a string if provided
    if payload.color is not None and not isinstance(payload.color, str):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Field 'color' must be a string if provided"
        )

    # Validate 'color' field is not an empty string
    if payload.color is not None and not payload.color.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Field 'color' must not be empty if provided"
        )

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    existing = await session.scalar(
        select(Collection).where(Collection.owner_id == user.id, Collection.name == payload.name.strip())
    )
    if existing:
        raise HTTPException(status_code=409, detail="A collection with this name already exists")
    from app.deliverables import ensure_personal_workspace

    workspace = await ensure_personal_workspace(user, session)
    collection = Collection(owner_id=user.id, workspace_id=workspace.id, name=payload.name.strip(), color=payload.color)
    session.add(collection)
    await session.commit()
    await session.refresh(collection)
    return collection


@router.patch("/collections/{collection_id}", response_model=CollectionResponse)
async def update_collection(
    collection_id: uuid.UUID,
    payload: CollectionUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Collection:
    collection = await owned_collection(collection_id, user, session)

    # Only validate fields that are actually provided in the payload
    if payload.name is not None:
        # Validate 'name' field if provided
        if not isinstance(payload.name, str):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Field 'name' must be a string"
            )

        if not payload.name.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Field 'name' must not be empty if provided"
            )

        # Validate name length to prevent oversized inputs
        if len(payload.name) > 255:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Field 'name' must be 255 characters or less"
            )
        collection.name = payload.name.strip()

    # Validate 'color' field if provided
    if payload.color is not None:
        if not isinstance(payload.color, str):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Field 'color' must be a string if provided"
            )

        if not payload.color.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Field 'color' must not be empty if provided"
            )
        collection.color = payload.color

    await session.commit()
    await session.refresh(collection)
    return collection


@router.delete("/collections/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(
    collection_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    collection = await owned_collection(collection_id, user, session)
    await session.delete(collection)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _validate_collection(collection_id: uuid.UUID | None, user: User, session: AsyncSession) -> None:
    if collection_id:
        await owned_collection(collection_id, user, session)


@router.patch("/documents/{document_id}/metadata", response_model=DocumentResponse)
async def update_document_metadata(
    document_id: uuid.UUID,
    payload: DocumentMetadataUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Document:
    document = await owned_document(document_id, user, session)
    await _validate_collection(payload.collection_id, user, session)
    document.display_title = payload.display_title.strip() if payload.display_title else None
    document.tags = payload.tags
    document.collection_id = payload.collection_id
    await session.commit()
    await session.refresh(document)
    return document
