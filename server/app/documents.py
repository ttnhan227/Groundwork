import re
import uuid

from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.dependencies import current_user
from app.models import Document, DocumentPage, DocumentStatus, JobStatus, ProcessingJob, User
from app.schemas import DocumentPageResponse, DocumentRenameRequest, DocumentResponse, ProcessingJobResponse
from app.storage import ObjectStorage

router = APIRouter(prefix="/documents", tags=["Documents"])


def safe_filename(name: str) -> str:
    basename = name.replace("\\", "/").split("/")[-1]
    value = re.sub(r"[^a-zA-Z0-9._ -]", "_", basename).strip(" .")
    return value[:180] or "document.pdf"


@router.get("", response_model=list[DocumentResponse])
async def list_documents(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[Document]:
    result = await session.scalars(select(Document).where(Document.owner_id == user.id).order_by(Document.created_at.desc()))
    return list(result)


async def owned_document(document_id: uuid.UUID, user: User, session: AsyncSession) -> Document:
    document = await session.scalar(select(Document).where(Document.id == document_id, Document.owner_id == user.id))
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: uuid.UUID, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Document:
    return await owned_document(document_id, user, session)


@router.patch("/{document_id}", response_model=DocumentResponse)
async def rename_document(
    document_id: uuid.UUID, payload: DocumentRenameRequest,
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
) -> Document:
    document = await owned_document(document_id, user, session)
    filename = safe_filename(payload.filename)
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"
    document.filename = filename
    await session.commit()
    await session.refresh(document)
    return document


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    document_id: uuid.UUID, user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
) -> Response:
    document = await owned_document(document_id, user, session)
    try:
        ObjectStorage().remove(document.object_key)
    except Exception:
        pass
    await session.delete(document)
    await session.commit()
    return Response(status_code=204)


@router.get("/{document_id}/job", response_model=ProcessingJobResponse)
async def get_processing_job(
    document_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessingJob:
    await owned_document(document_id, user, session)
    job = await session.scalar(
        select(ProcessingJob).where(ProcessingJob.document_id == document_id).order_by(ProcessingJob.created_at.desc())
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Processing job not found")
    return job


@router.get("/{document_id}/pages", response_model=list[DocumentPageResponse])
async def get_document_pages(
    document_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[DocumentPage]:
    await owned_document(document_id, user, session)
    result = await session.scalars(
        select(DocumentPage).where(DocumentPage.document_id == document_id).order_by(DocumentPage.page_number)
    )
    return list(result)


@router.get("/{document_id}/content")
async def download_document(
    document_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    document = await owned_document(document_id, user, session)
    data = ObjectStorage().download(document.object_key)
    disposition = f'inline; filename="{safe_filename(document.filename)}"'
    return StreamingResponse(BytesIO(data), media_type="application/pdf", headers={"Content-Disposition": disposition})


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Document:
    settings = get_settings()
    document_count = await session.scalar(select(func.count(Document.id)).where(Document.owner_id == user.id))
    if (document_count or 0) >= settings.max_documents_per_user:
        raise HTTPException(status_code=422, detail=f"Document limit reached ({settings.max_documents_per_user})")
    filename = safe_filename(file.filename or "document.pdf")
    if not filename.lower().endswith(".pdf") or file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Only PDF files are accepted")
    data = await file.read(settings.max_file_size_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_file_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_file_size_mb} MB")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=422, detail="The file is not a valid PDF")
    document_id = uuid.uuid4()
    object_key = f"{user.id}/{document_id}/{filename}"
    storage = ObjectStorage()
    try:
        storage.upload_pdf(object_key, data)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Document storage is temporarily unavailable") from exc
    document = Document(
        id=document_id,
        owner_id=user.id,
        filename=filename,
        object_key=object_key,
        content_type="application/pdf",
        size_bytes=len(data),
    )
    session.add(document)
    job = ProcessingJob(
        document_id=document_id,
        owner_id=user.id,
        operation="document_processing",
        status=JobStatus.QUEUED,
        progress=0,
    )
    session.add(job)
    await session.commit()
    await session.refresh(document)
    from app.tasks import process_document

    try:
        task = process_document.delay(str(document.id))
        job.task_id = task.id
        await session.commit()
    except Exception as exc:
        document.status = DocumentStatus.FAILED
        document.error_message = "Processing queue is temporarily unavailable"
        job.status = JobStatus.FAILED
        job.error_message = document.error_message
        await session.commit()
        raise HTTPException(status_code=503, detail=document.error_message) from exc
    return document


@router.post("/{document_id}/retry", response_model=ProcessingJobResponse)
async def retry_document(
    document_id: uuid.UUID, user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
) -> ProcessingJob:
    document = await owned_document(document_id, user, session)
    if document.status != DocumentStatus.FAILED:
        raise HTTPException(status_code=409, detail="Only failed documents can be retried")
    job = ProcessingJob(
        document_id=document.id,
        owner_id=user.id,
        operation="document_processing",
        status=JobStatus.QUEUED,
        progress=0,
    )
    document.status = DocumentStatus.UPLOADED
    document.error_message = None
    session.add(job)
    await session.commit()
    await session.refresh(job)
    from app.tasks import process_document
    try:
        task = process_document.delay(str(document.id))
        job.task_id = task.id
        await session.commit()
    except Exception as exc:
        job.status = JobStatus.FAILED
        job.error_message = "Processing queue is temporarily unavailable"
        document.status = DocumentStatus.FAILED
        await session.commit()
        raise HTTPException(status_code=503, detail=job.error_message) from exc
    return job
