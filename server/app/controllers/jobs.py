import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.dependencies import current_user
from app.document_conversions import validate_docx
from app.documents import owned_document, safe_filename
from app.models import JobStatus, ProcessingJob, User
from app.schemas import OperationJobCreate, ProcessingJobResponse
from app.storage import ObjectStorage

router = APIRouter(prefix="/jobs", tags=["Background jobs"])


def _document_ids(payload: OperationJobCreate) -> list[uuid.UUID]:
    values: list[str] = []
    parameters = payload.parameters
    for key in ("document_id", "left_document_id", "right_document_id"):
        if parameters.get(key):
            values.append(str(parameters[key]))
    values.extend(str(item) for item in parameters.get("document_ids", []))
    try:
        return list(dict.fromkeys(uuid.UUID(value) for value in values))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Job contains an invalid document ID") from exc


@router.get("", response_model=list[ProcessingJobResponse])
async def list_jobs(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ProcessingJob]:
    return list(
        await session.scalars(
            select(ProcessingJob)
            .where(ProcessingJob.owner_id == user.id)
            .order_by(ProcessingJob.created_at.desc())
            .limit(100)
        )
    )


@router.get("/status/{job_id}", response_model=ProcessingJobResponse)
async def get_job(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessingJob:
    job = await session.scalar(
        select(ProcessingJob).where(
            ProcessingJob.id == job_id,
            ProcessingJob.owner_id == user.id,
        )
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Background job not found")
    return job


@router.post("/status/{job_id}/cancel", response_model=ProcessingJobResponse)
async def cancel_job(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessingJob:
    job = await get_job(job_id, user, session)
    if job.status in {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}:
        if job.status == JobStatus.CANCELLED:
            return job
        raise HTTPException(status_code=409, detail="This job has already finished")
    job.status = JobStatus.CANCELLED
    job.error_message = "Cancelled by user"
    job.completed_at = datetime.now(UTC)
    await session.commit()
    if job.task_id:
        from app.celery_app import celery_app

        celery_app.control.revoke(job.task_id, terminate=True, signal="SIGTERM")
    await session.refresh(job)
    return job


@router.post("", response_model=ProcessingJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_job(
    payload: OperationJobCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessingJob:
    document_ids = _document_ids(payload)
    if not document_ids:
        raise HTTPException(status_code=422, detail="At least one source document is required")
    for document_id in document_ids:
        await owned_document(document_id, user, session)

    job = ProcessingJob(
        owner_id=user.id,
        document_id=document_ids[0] if len(document_ids) == 1 else None,
        operation=payload.operation,
        parameters=payload.parameters,
        status=JobStatus.QUEUED,
        progress=0,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    from app.tasks import process_operation

    try:
        task = process_operation.delay(str(job.id))
        job.task_id = task.id
        await session.commit()
        await session.refresh(job)
    except Exception as exc:
        job.status = JobStatus.FAILED
        job.error_message = "Processing queue is temporarily unavailable"
        await session.commit()
        raise HTTPException(status_code=503, detail=job.error_message) from exc
    return job


@router.post("/images-to-pdf", response_model=ProcessingJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_images_to_pdf_job(
    files: list[UploadFile] = File(...),
    save_sources: bool = Form(default=False),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessingJob:
    if not files:
        raise HTTPException(
            status_code=422,
            detail="The 'files' field is required and must contain at least one image"
        )
    if not 1 <= len(files) <= 50:
        raise HTTPException(status_code=422, detail="Upload between 1 and 50 images")
    if any(file.content_type not in {"image/png", "image/jpeg"} for file in files):
        raise HTTPException(status_code=415, detail="Only PNG and JPEG images are accepted")
    
    # Validate save_sources is a boolean
    if isinstance(save_sources, str):
        if save_sources.lower() in ("true", "1"):
            save_sources = True
        elif save_sources.lower() in ("false", "0"):
            save_sources = False
        else:
            raise HTTPException(
                status_code=422,
                detail="'save_sources' must be a boolean value (true/false)"
            )
    
    storage = ObjectStorage()
    staged: list[str] = []
    source_files: list[dict[str, str]] = []
    try:
        for position, file in enumerate(files):
            content = await file.read(20 * 1024 * 1024 + 1)
            if len(content) > 20 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Each image must be 20 MB or smaller")
            key = f"{user.id}/staging/{uuid.uuid4()}/{position:03d}"
            storage.upload(key, content, file.content_type or "application/octet-stream")
            staged.append(key)
            source_files.append(
                {
                    "filename": safe_filename(file.filename or f"image-{position + 1}.png"),
                    "content_type": file.content_type or "application/octet-stream",
                }
            )
        return await create_job_without_documents(
            "images_to_pdf",
            {"staged_keys": staged, "save_sources": save_sources, "source_files": source_files},
            user,
            session,
        )
    except Exception:
        for key in staged:
            try:
                storage.remove(key)
            except Exception:
                continue
        raise


@router.post("/watermark", response_model=ProcessingJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_watermark_job(
    document_id: uuid.UUID | None = Form(default=None),
    text: str | None = Form(default=None, max_length=120),
    page_numbers: str = Form(default=""),
    position: str = Form(default="center"),
    opacity: float = Form(default=0.25),
    rotation: int = Form(default=0),
    image: UploadFile | None = File(default=None),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessingJob:
    # Check if user is authenticated before processing
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    # Validate document_id is not an object/type mismatch
    if isinstance(document_id, dict):
        raise HTTPException(
            status_code=422,
            detail="document_id must be a string or UUID, not an object"
        )
    
    if document_id is None:
        raise HTTPException(
            status_code=422,
            detail="document_id is required"
        )
    
    # Validate document_id length to prevent potential crashes from oversized strings
    if isinstance(document_id, str):
        if len(document_id) > 36:  # UUID length
            raise HTTPException(
                status_code=422,
                detail="document_id must be a valid UUID"
            )
        try:
            document_id = uuid.UUID(document_id)
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail="document_id must be a valid UUID"
            )
    
    # Explicitly check for empty string case
    if isinstance(document_id, str) and document_id.strip() == "":
        raise HTTPException(
            status_code=422,
            detail="document_id cannot be an empty string"
        )
    
    await owned_document(document_id, user, session)
    
    # Validate text is not an object and not empty when provided
    if isinstance(text, dict):
        raise HTTPException(
            status_code=422,
            detail="text must be a string, not an object"
        )
    
    # Validate text is not empty when provided
    if text is not None and text.strip() == "":
        raise HTTPException(
            status_code=422,
            detail="text cannot be an empty string"
        )
    
    # Validate page_numbers is not empty when it should contain values
    if page_numbers.strip() == "":
        raise HTTPException(
            status_code=422,
            detail="page_numbers must be provided as comma-separated numbers"
        )
    
    try:
        pages = [int(item.strip()) for item in page_numbers.split(",") if item.strip()]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Pages must be comma-separated numbers") from exc
    staged_key = None
    if image is not None:
        if image.content_type not in {"image/png", "image/jpeg"}:
            raise HTTPException(status_code=415, detail="Watermark image must be PNG or JPEG")
        content = await image.read(10 * 1024 * 1024 + 1)
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Watermark image must be 10 MB or smaller")
        staged_key = f"{user.id}/staging/{uuid.uuid4()}/watermark"
        ObjectStorage().upload(staged_key, content, image.content_type)
    parameters = {
        "document_id": str(document_id),
        "text": text,
        "page_numbers": pages,
        "position": position,
        "opacity": opacity,
        "rotation": rotation,
        "staged_image_key": staged_key,
    }
    try:
        return await create_job(
            OperationJobCreate(operation="watermark", parameters=parameters),
            user,
            session,
        )
    except Exception:
        if staged_key:
            ObjectStorage().remove(staged_key)
        raise


@router.post("/convert-docx", response_model=ProcessingJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_docx_conversion_job(
    file: UploadFile = File(...),
    target: str = Form(..., pattern="^(pdf|markdown)$"),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessingJob:
    # Check authentication first before any other processing
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    # Validate file is provided and not empty
    if file is None:
        raise HTTPException(status_code=422, detail="File is required")
    
    # Validate file is a string (not an object) - handle malformed payloads
    if isinstance(file, dict):
        raise HTTPException(
            status_code=422,
            detail="'file' must be a string or file upload, not an object"
        )
    
    # Validate file.filename is not empty
    if not file.filename:
        raise HTTPException(status_code=422, detail="Filename is required")
    
    # Validate target is provided and matches expected pattern
    if not target or target not in ("pdf", "markdown"):
        raise HTTPException(status_code=422, detail="Target must be either 'pdf' or 'markdown'")
    
    # Validate target is not an object/type mismatch
    if isinstance(target, dict):
        raise HTTPException(
            status_code=422,
            detail="'target' must be a string, not an object"
        )
    
    # Explicitly check for empty string case for target
    if isinstance(target, str) and target.strip() == "":
        raise HTTPException(status_code=422, detail="Target cannot be an empty string")
    
    filename = safe_filename(file.filename or "document.docx")
    if not filename.lower().endswith(".docx"):
        raise HTTPException(status_code=415, detail="Upload a DOCX Word document")
    
    # Validate file content is not empty
    content = await file.read(1)
    if not content:
        await file.close()
        raise HTTPException(status_code=422, detail="File content cannot be empty")
    
    settings = get_settings()
    
    # Read file content in chunks to validate size without loading entire file into memory
    max_size_bytes = settings.max_file_size_mb * 1024 * 1024
    try:
        while True:
            chunk = await file.read(8192)
            if not chunk:
                break
            content += chunk
            if len(content) > max_size_bytes:
                await file.close()
                raise HTTPException(
                    status_code=413,
                    detail=f"File exceeds {settings.max_file_size_mb} MB"
                )
    except Exception as exc:
        await file.close()
        raise HTTPException(status_code=422, detail="Error reading file") from exc
    
    try:
        validate_docx(content)
    except ValueError as exc:
        await file.close()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    
    staged_key = f"{user.id}/staging/{uuid.uuid4()}/{filename}"
    ObjectStorage().upload(
        staged_key,
        content,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    operation = "docx_to_pdf" if target == "pdf" else "docx_to_markdown"
    try:
        return await create_job_without_documents(
            operation,
            {"staged_key": staged_key, "source_filename": filename},
            user,
            session,
        )
    except Exception:
        ObjectStorage().remove(staged_key)
        raise


async def create_job_without_documents(
    operation: str,
    parameters: dict,
    user: User,
    session: AsyncSession,
) -> ProcessingJob:
    job = ProcessingJob(
        owner_id=user.id,
        operation=operation,
        parameters=parameters,
        status=JobStatus.QUEUED,
        progress=0,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    from app.tasks import process_operation

    try:
        task = process_operation.delay(str(job.id))
        job.task_id = task.id
        await session.commit()
        await session.refresh(job)
    except Exception as exc:
        job.status = JobStatus.FAILED
        job.error_message = "Processing queue is temporarily unavailable"
        await session.commit()
        raise HTTPException(status_code=503, detail=job.error_message) from exc
    return job


@router.post("/status/{job_id}/retry", response_model=ProcessingJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def retry_job(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessingJob:
    failed = await get_job(job_id, user, session)
    if failed.status != JobStatus.FAILED or failed.operation == "document_processing":
        raise HTTPException(status_code=409, detail="Only failed operation jobs can be retried here")
    if failed.operation in {"docx_to_pdf", "docx_to_markdown", "ai_create"}:
        return await create_job_without_documents(
            failed.operation,
            failed.parameters,
            user,
            session,
        )
    return await create_job(
        OperationJobCreate(operation=failed.operation, parameters=failed.parameters),
        user,
        session,
    )