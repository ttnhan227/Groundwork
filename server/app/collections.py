import json
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.dependencies import current_user
from app.documents import owned_document
from app.models import Collection, Document, DocumentPage, GeneratedArtifact, User
from app.schemas import (
    CollectionCreate,
    CollectionResponse,
    CollectionUpdate,
    DocumentMetadataUpdate,
    DocumentResponse,
)
from app.usage import record_ai_usage

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
    return list(await session.scalars(
        select(Collection).where(Collection.owner_id == user.id).order_by(Collection.name)
    ))


@router.post("/collections", response_model=CollectionResponse, status_code=status.HTTP_201_CREATED)
async def create_collection(
    payload: CollectionCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Collection:
    existing = await session.scalar(
        select(Collection).where(Collection.owner_id == user.id, Collection.name == payload.name.strip())
    )
    if existing:
        raise HTTPException(status_code=409, detail="A collection with this name already exists")
    collection = Collection(owner_id=user.id, name=payload.name.strip(), color=payload.color)
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
    collection.name = payload.name.strip()
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
    collection = await owned_collection(collection_id, user, session)
    await session.delete(collection)
    await session.commit()
    return Response(status_code=204)


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


@router.patch("/pdf-tools/artifacts/{artifact_id}/collection", response_model=dict)
async def update_artifact_collection(
    artifact_id: uuid.UUID,
    payload: DocumentMetadataUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    artifact = await session.scalar(
        select(GeneratedArtifact).where(
            GeneratedArtifact.id == artifact_id,
            GeneratedArtifact.owner_id == user.id,
        )
    )
    if artifact is None:
        raise HTTPException(status_code=404, detail="Generated file not found")
    await _validate_collection(payload.collection_id, user, session)
    artifact.collection_id = payload.collection_id
    await session.commit()
    return {"id": str(artifact.id), "collection_id": str(artifact.collection_id) if artifact.collection_id else None}


@router.post("/documents/{document_id}/generate-metadata", response_model=DocumentResponse)
async def generate_document_metadata(
    document_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Document:
    document = await owned_document(document_id, user, session)
    pages = list(await session.scalars(
        select(DocumentPage)
        .where(DocumentPage.document_id == document.id)
        .order_by(DocumentPage.page_number)
        .limit(8)
    ))
    context = "\n\n".join(page.text for page in pages)[:16_000].strip()
    if not context:
        raise HTTPException(status_code=409, detail="The document has no indexed text for metadata generation")
    settings = get_settings()
    if not settings.llm_api_key:
        raise HTTPException(status_code=503, detail="LLM_API_KEY is not configured")
    await record_ai_usage(user, "document_metadata", session)
    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            response = await client.post(
                f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                json={
                    "model": settings.llm_model,
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "Create concise library metadata using only the supplied document text. "
                                "Return JSON with title (max 90 characters) and tags (3-6 short lowercase strings)."
                            ),
                        },
                        {"role": "user", "content": context},
                    ],
                },
            )
        response.raise_for_status()
        value = json.loads(response.json()["choices"][0]["message"]["content"])
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="The language model could not generate document metadata") from exc
    title = str(value.get("title", "")).strip()[:180]
    tags = [str(tag).strip().lower()[:40] for tag in value.get("tags", []) if str(tag).strip()][:6]
    document.display_title = title or document.filename.rsplit(".", 1)[0]
    document.tags = list(dict.fromkeys(tags))
    await session.commit()
    await session.refresh(document)
    return document
