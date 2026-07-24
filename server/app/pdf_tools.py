import json
import uuid
from io import BytesIO

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies import current_user
from app.documents import owned_document, safe_filename
from app.models import Document, DocumentStatus, GeneratedArtifact, User
from app.pdf_operations import (
    delete_pages,
    images_to_pdf,
    merge_pdfs,
    pdf_to_images,
    rotate_pages,
    select_pages,
    split_pdf,
    watermark_pdf,
)
from app.schemas import (
    ArtifactResponse,
    MergeRequest,
    PDFToImagesRequest,
    PageOperationRequest,
    RotateRequest,
    SplitRequest,
)
from app.storage import ObjectStorage

router = APIRouter(prefix="/pdf-tools", tags=["PDF tools"])


async def _ready_document(identifier: uuid.UUID, user: User, session: AsyncSession) -> Document:
    document = await owned_document(identifier, user, session)
    if document.status != DocumentStatus.READY:
        raise HTTPException(status_code=409, detail="The document must finish processing first")
    return document


async def _store(
    operation: str,
    filename: str,
    data: bytes,
    content_type: str,
    parameters: dict,
    user: User,
    session: AsyncSession,
) -> GeneratedArtifact:
    identifier = uuid.uuid4()
    filename = safe_filename(filename)
    key = f"{user.id}/generated/{identifier}/{filename}"
    try:
        ObjectStorage().upload(key, data, content_type)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Generated-file storage is temporarily unavailable") from exc
    artifact = GeneratedArtifact(
        id=identifier, owner_id=user.id, operation=operation, filename=filename,
        object_key=key, content_type=content_type, size_bytes=len(data), parameters=parameters,
    )
    session.add(artifact)
    await session.commit()
    await session.refresh(artifact)
    return artifact


def _run(operation):
    try:
        return operation()
    except (ValueError, TypeError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/artifacts", response_model=list[ArtifactResponse])
async def list_artifacts(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> list[GeneratedArtifact]:
    return list(await session.scalars(
        select(GeneratedArtifact).where(GeneratedArtifact.owner_id == user.id).order_by(GeneratedArtifact.created_at.desc())
    ))


@router.get("/artifacts/{artifact_id}/download")
async def download_artifact(
    artifact_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    artifact = await session.scalar(
        select(GeneratedArtifact).where(GeneratedArtifact.id == artifact_id, GeneratedArtifact.owner_id == user.id)
    )
    if artifact is None:
        raise HTTPException(status_code=404, detail="Generated file not found")
    data = ObjectStorage().download(artifact.object_key)
    return StreamingResponse(
        BytesIO(data), media_type=artifact.content_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_filename(artifact.filename)}"'},
    )


@router.post("/merge", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
async def merge(
    payload: MergeRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> GeneratedArtifact:
    if len(set(payload.document_ids)) != len(payload.document_ids):
        raise HTTPException(status_code=422, detail="Select each PDF only once")
    documents = [await _ready_document(item, user, session) for item in payload.document_ids]
    data = _run(lambda: merge_pdfs([ObjectStorage().download(document.object_key) for document in documents]))
    return await _store("merge", "merged.pdf", data, "application/pdf", payload.model_dump(mode="json"), user, session)


async def _page_operation(
    operation: str, suffix: str, payload: PageOperationRequest, transform, user: User, session: AsyncSession
) -> GeneratedArtifact:
    document = await _ready_document(payload.document_id, user, session)
    data = _run(lambda: transform(ObjectStorage().download(document.object_key)))
    filename = f"{document.filename.removesuffix('.pdf')}-{suffix}.pdf"
    return await _store(operation, filename, data, "application/pdf", payload.model_dump(mode="json"), user, session)


@router.post("/extract", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
async def extract_pages_route(payload: PageOperationRequest, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    return await _page_operation("extract", "extracted", payload, lambda data: select_pages(data, payload.page_numbers), user, session)


@router.post("/delete-pages", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
async def delete_pages_route(payload: PageOperationRequest, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    return await _page_operation("delete_pages", "pages-removed", payload, lambda data: delete_pages(data, payload.page_numbers), user, session)


@router.post("/rotate", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
async def rotate(payload: RotateRequest, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    return await _page_operation("rotate", "rotated", payload, lambda data: rotate_pages(data, payload.page_numbers, payload.degrees), user, session)


@router.post("/split", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
async def split(payload: SplitRequest, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    document = await _ready_document(payload.document_id, user, session)
    data = _run(lambda: split_pdf(ObjectStorage().download(document.object_key), payload.mode, payload.ranges, payload.page_numbers))
    return await _store("split", f"{document.filename.removesuffix('.pdf')}-split.zip", data, "application/zip", payload.model_dump(mode="json"), user, session)


@router.post("/pdf-to-images", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
async def convert_pdf_to_images(payload: PDFToImagesRequest, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    document = await _ready_document(payload.document_id, user, session)
    data = _run(lambda: pdf_to_images(ObjectStorage().download(document.object_key), payload.page_numbers, payload.format, payload.dpi))
    return await _store("pdf_to_images", f"{document.filename.removesuffix('.pdf')}-images.zip", data, "application/zip", payload.model_dump(mode="json"), user, session)


@router.post("/images-to-pdf", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
async def convert_images_to_pdf(
    files: list[UploadFile] = File(...),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> GeneratedArtifact:
    if not 1 <= len(files) <= 50:
        raise HTTPException(status_code=422, detail="Upload between 1 and 50 images")
    allowed = {"image/png", "image/jpeg"}
    if any(file.content_type not in allowed for file in files):
        raise HTTPException(status_code=415, detail="Only PNG and JPEG images are accepted")
    content = [await file.read(20 * 1024 * 1024 + 1) for file in files]
    if any(len(item) > 20 * 1024 * 1024 for item in content):
        raise HTTPException(status_code=413, detail="Each image must be 20 MB or smaller")
    data = _run(lambda: images_to_pdf(content))
    return await _store("images_to_pdf", "images.pdf", data, "application/pdf", {"image_count": len(files)}, user, session)


@router.post("/watermark", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
async def watermark(
    document_id: uuid.UUID = Form(...),
    text: str | None = Form(default=None, max_length=120),
    page_numbers: str = Form(default=""),
    position: str = Form(default="center"),
    opacity: float = Form(default=.25),
    rotation: int = Form(default=0),
    image: UploadFile | None = File(default=None),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> GeneratedArtifact:
    document = await _ready_document(document_id, user, session)
    image_data = None
    if image:
        if image.content_type not in {"image/png", "image/jpeg"}:
            raise HTTPException(status_code=415, detail="Watermark image must be PNG or JPEG")
        image_data = await image.read(10 * 1024 * 1024 + 1)
        if len(image_data) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Watermark image must be 10 MB or smaller")
    try:
        pages = [int(item.strip()) for item in page_numbers.split(",") if item.strip()] or None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Pages must be comma-separated numbers") from exc
    data = _run(lambda: watermark_pdf(
        ObjectStorage().download(document.object_key), text.strip() if text else None,
        image_data, pages, position, opacity, rotation,
    ))
    parameters = {"text": text, "page_numbers": pages, "position": position, "opacity": opacity, "rotation": rotation, "has_image": bool(image)}
    return await _store("watermark", f"{document.filename.removesuffix('.pdf')}-watermarked.pdf", data, "application/pdf", parameters, user, session)
