import hashlib
import re
import tempfile
import textwrap
import uuid
import zipfile
from datetime import UTC, datetime
from io import BytesIO

import fitz
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from pptx import Presentation
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.database import get_session
from app.dependencies import current_user
from app.document_conversions import docx_to_markdown, validate_docx
from app.models import (
    Document,
    DocumentPage,
    DocumentStatus,
    GeneratedArtifact,
    JobStatus,
    ProcessingJob,
    User,
)
from app.dtos.document_dto import (
    TextSourceCreateRequest,
    UrlSourceCreateRequest,
    YouTubeSourceCreateRequest,
)
from html.parser import HTMLParser
import httpx
from app.services.ai_orchestration import ai_orchestrator
from app.schemas import (
    DocumentArchiveRequest,
    DocumentPageResponse,
    DocumentRenameRequest,
    DocumentResponse,
    ProcessingJobResponse,
)
from app.storage import ObjectStorage

router = APIRouter(prefix="/documents", tags=["Documents"])


def safe_filename(name: str) -> str:
    basename = name.replace("\\", "/").split("/")[-1]
    value = re.sub(r"[^a-zA-Z0-9._ -]", "_", basename).strip(" .")
    return value[:180] or "document.pdf"


IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_IMAGE_PIXELS = 40_000_000
TEXT_CONTENT_TYPES = {"text/plain", "text/markdown", "text/rtf", "application/rtf"}
DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PPTX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def text_to_pdf(text: str, title: str) -> bytes:
    """Create a readable normalized derivative without claiming native-format fidelity."""
    cleaned = text.replace("\x00", "").strip()
    if not cleaned:
        raise ValueError("The document does not contain readable text")
    pdf = fitz.open()
    try:
        lines: list[str] = []
        for raw_line in cleaned.splitlines():
            if not raw_line.strip():
                lines.append("")
                continue
            lines.extend(
                textwrap.wrap(
                    raw_line,
                    width=88,
                    replace_whitespace=False,
                    drop_whitespace=True,
                    break_long_words=True,
                    break_on_hyphens=False,
                )
                or [""]
            )
        lines_per_page = 42
        for offset in range(0, len(lines), lines_per_page):
            page = pdf.new_page(width=595, height=842)
            if offset == 0:
                page.insert_textbox(
                    fitz.Rect(52, 42, 543, 78), title, fontsize=16, fontname="helv", color=(0.08, 0.12, 0.24)
                )
            top = 92 if offset == 0 else 52
            page.insert_textbox(
                fitz.Rect(52, top, 543, 790),
                "\n".join(lines[offset : offset + lines_per_page]),
                fontsize=10,
                fontname="helv",
                lineheight=1.35,
                color=(0.12, 0.15, 0.22),
            )
        return pdf.tobytes(garbage=4, deflate=True)
    finally:
        pdf.close()


def source_to_pdf(data: bytes, suffix: str, title: str) -> bytes:
    if suffix == "pdf":
        if not data.startswith(b"%PDF-"):
            raise ValueError("The uploaded file is not a valid PDF")
        return data
    if suffix == "docx":
        validate_docx(data)
        return text_to_pdf(docx_to_markdown(data).decode("utf-8"), title)
    if suffix == "pptx":
        try:
            presentation = Presentation(BytesIO(data))
        except Exception as exc:
            raise ValueError("The uploaded file is not a valid PPTX presentation") from exc
        slides: list[str] = []
        for index, slide in enumerate(presentation.slides, start=1):
            values = [shape.text.strip() for shape in slide.shapes if hasattr(shape, "text") and shape.text.strip()]
            slides.append(f"Slide {index}\n" + "\n".join(values))
        return text_to_pdf("\n\n".join(slides), title)
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = data.decode("cp1252")
        except UnicodeDecodeError as exc:
            raise ValueError("The text encoding is not supported") from exc
    if suffix == "rtf":
        text = re.sub(r"\\'[0-9a-fA-F]{2}", " ", text)
        text = re.sub(r"\\[a-zA-Z]+-?\d* ?|[{}]", "", text)
    return text_to_pdf(text, title)


def image_to_pdf(data: bytes) -> bytes:
    """Validate and normalize a supported image into a one-page PDF."""
    try:
        with Image.open(BytesIO(data)) as source:
            if source.format not in IMAGE_FORMATS:
                raise ValueError("Only PNG, JPEG, and WebP images are accepted")
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise ValueError("Image dimensions are too large")
            source.load()
            image = ImageOps.exif_transpose(source)
            if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
                rgba = image.convert("RGBA")
                normalized = Image.new("RGB", rgba.size, "white")
                normalized.paste(rgba, mask=rgba.getchannel("A"))
            else:
                normalized = image.convert("RGB")
            output = BytesIO()
            normalized.save(output, format="PDF", resolution=150.0, quality=92)
            return output.getvalue()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("The file is not a valid supported image") from exc


@router.get("", response_model=list[DocumentResponse])
async def list_documents(
    workspace_id: uuid.UUID | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Document]:
    query = select(Document).where(Document.owner_id == user.id)
    if workspace_id is not None:
        query = query.where(Document.workspace_id == workspace_id)
    result = await session.scalars(query.order_by(Document.created_at.desc()))
    documents = list(result)
    return documents


def unique_archive_name(filename: str, used_names: set[str]) -> str:
    safe_name = safe_filename(filename)
    stem, separator, suffix = safe_name.rpartition(".")
    if not separator:
        stem, suffix = safe_name, ""
    candidate = safe_name
    counter = 2
    while candidate.casefold() in used_names:
        candidate = f"{stem} ({counter}){'.' + suffix if suffix else ''}"
        counter += 1
    used_names.add(candidate.casefold())
    return candidate


def build_documents_archive(files: list[tuple[str, str]]):
    archive = tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
    storage = ObjectStorage()
    used_names: set[str] = set()
    try:
        with zipfile.ZipFile(archive, mode="w", compression=zipfile.ZIP_STORED) as bundle:
            for filename, object_key in files:
                bundle.writestr(
                    unique_archive_name(filename, used_names),
                    storage.download(object_key),
                )
        archive.seek(0)
        return archive
    except Exception:
        archive.close()
        raise


@router.post("/download-zip")
async def download_documents_archive(
    payload: DocumentArchiveRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    # Validate required 'files' field
    if payload.files is None or len(payload.files) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The 'files' field is required and must contain at least one item",
        )
    references = list(dict.fromkeys((item.kind, item.id) for item in payload.files))
    if len(references) < 2:
        raise HTTPException(status_code=422, detail="Select at least two different files")
    document_ids = [identifier for kind, identifier in references if kind == "document"]
    artifact_ids = [identifier for kind, identifier in references if kind == "artifact"]
    documents = (
        list(await session.scalars(select(Document).where(Document.id.in_(document_ids), Document.owner_id == user.id)))
        if document_ids
        else []
    )
    artifacts = (
        list(
            await session.scalars(
                select(GeneratedArtifact).where(
                    GeneratedArtifact.id.in_(artifact_ids), GeneratedArtifact.owner_id == user.id
                )
            )
        )
        if artifact_ids
        else []
    )
    document_map = {item.id: item for item in documents}
    artifact_map = {item.id: item for item in artifacts}
    if len(document_map) != len(document_ids) or len(artifact_map) != len(artifact_ids):
        raise HTTPException(status_code=404, detail="One or more files were not found")
    files = [
        (document_map[identifier].filename, document_map[identifier].object_key)
        if kind == "document"
        else (artifact_map[identifier].filename, artifact_map[identifier].object_key)
        for kind, identifier in references
    ]
    total_size = sum(document_map[item].size_bytes for item in document_ids) + sum(
        artifact_map[item].size_bytes for item in artifact_ids
    )
    if total_size > 500 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Selected documents exceed the 500 MB archive limit")

    try:
        archive = await run_in_threadpool(build_documents_archive, files)
    except Exception:
        raise HTTPException(status_code=503, detail="Could not prepare the document archive")

    def stream_archive():
        try:
            while chunk := archive.read(1024 * 1024):
                yield chunk
        finally:
            archive.close()

    return StreamingResponse(
        stream_archive(),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="groundwork-documents.zip"',
            "X-File-Count": str(len(files)),
        },
    )


async def owned_document(document_id: uuid.UUID, user: User, session: AsyncSession) -> Document:
    document = await session.scalar(select(Document).where(Document.id == document_id, Document.owner_id == user.id))
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: uuid.UUID, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> Document:
    return await owned_document(document_id, user, session)


@router.patch("/{document_id}", response_model=DocumentResponse)
async def rename_document(
    document_id: uuid.UUID,
    payload: DocumentRenameRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Document:
    # Validate that filename is a string type
    if not isinstance(payload.filename, str):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"filename": "Must be a string"})
    if payload.filename is None or payload.filename.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The 'filename' field is required and cannot be empty",
        )
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
    document_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    document = await owned_document(document_id, user, session)
    try:
        ObjectStorage().remove(document.object_key)
    except Exception:
        pass
    if document.original_object_key:
        try:
            ObjectStorage().remove(document.original_object_key)
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


@router.get("/{document_id}/original")
async def download_original_document(
    document_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    document = await owned_document(document_id, user, session)
    key = document.original_object_key or document.object_key
    filename = document.original_filename or document.filename
    content_type = document.original_content_type or document.content_type
    data = ObjectStorage().download(key)
    return StreamingResponse(
        BytesIO(data),
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_filename(filename)}"'},
    )


@router.get("/{document_id}/thumbnail")
async def document_thumbnail(
    document_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    document = await owned_document(document_id, user, session)
    pdf = fitz.open(stream=ObjectStorage().download(document.object_key), filetype="pdf")
    try:
        if not pdf.page_count:
            raise HTTPException(status_code=422, detail="The PDF has no pages")
        image = pdf[0].get_pixmap(matrix=fitz.Matrix(0.55, 0.55), alpha=False).tobytes("png")
    finally:
        pdf.close()
    return Response(
        content=image,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    workspace_id: str | None = Form(default=None),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Document:
    if file.filename is None or file.filename.strip() == "":
        raise HTTPException(status_code=422, detail="File name cannot be empty")
    settings = get_settings()
    today = datetime.now(UTC).date()
    daily_user_uploads = await session.scalar(
        select(func.count(Document.id)).where(
            Document.owner_id == user.id,
            func.date(Document.created_at) == today,
        )
    )
    if (daily_user_uploads or 0) >= settings.daily_upload_limit_per_user:
        raise HTTPException(status_code=429, detail="Daily upload limit reached")
    daily_global_uploads = await session.scalar(
        select(func.count(Document.id)).where(func.date(Document.created_at) == today)
    )
    if (daily_global_uploads or 0) >= settings.global_daily_upload_limit:
        raise HTTPException(status_code=429, detail="The preview has reached its daily upload limit")
    document_count = await session.scalar(select(func.count(Document.id)).where(Document.owner_id == user.id))
    if (document_count or 0) >= settings.max_documents_per_user:
        raise HTTPException(status_code=422, detail=f"Document limit reached ({settings.max_documents_per_user})")
    original_filename = safe_filename(file.filename or "document.pdf")
    suffix = original_filename.lower().rsplit(".", 1)[-1] if "." in original_filename else ""
    generic_upload_types = {None, "", "application/octet-stream", "application/zip"}
    is_pdf = suffix == "pdf" and (
        file.content_type in {"application/pdf", "application/x-pdf", *generic_upload_types} or not file.content_type
    )
    is_image = suffix in {"png", "jpg", "jpeg", "webp"} and (
        file.content_type in {*IMAGE_CONTENT_TYPES, *generic_upload_types} or not file.content_type
    )
    is_docx = suffix == "docx" and (
        file.content_type in {DOCX_CONTENT_TYPE, *generic_upload_types} or not file.content_type
    )
    is_pptx = suffix == "pptx" and (
        file.content_type in {PPTX_CONTENT_TYPE, *generic_upload_types} or not file.content_type
    )
    is_text = suffix in {"txt", "md", "markdown", "rtf"} and (
        file.content_type in {*TEXT_CONTENT_TYPES, *generic_upload_types} or not file.content_type
    )
    if not is_pdf and not is_image and not is_docx and not is_pptx and not is_text:
        raise HTTPException(
            status_code=415, detail="Supported sources are PDF, DOCX, PPTX, Markdown, text, RTF, PNG, JPEG, and WebP"
        )
    data = await file.read(settings.max_file_size_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_file_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_file_size_mb} MB")
    if is_pdf and not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=422, detail="The file is not a valid PDF")
    from app.deliverables import activity, ensure_personal_workspace, workspace_access

    ws_uuid: uuid.UUID | None = None
    if workspace_id is not None and str(workspace_id).strip() != "":
        if str(workspace_id).strip().lower() in {"null", "undefined"}:
            raise HTTPException(status_code=422, detail="Invalid workspace_id")
        try:
            ws_uuid = uuid.UUID(str(workspace_id).strip())
        except (ValueError, AttributeError):
            raise HTTPException(status_code=422, detail="Invalid workspace_id")

    if ws_uuid is not None:
        workspace, _ = await workspace_access(ws_uuid, user, session, {"owner", "editor"})
    else:
        workspace = await ensure_personal_workspace(user, session)

    source_sha256 = hashlib.sha256(data).hexdigest()
    duplicate = await session.scalar(
        select(Document).where(
            Document.owner_id == user.id, Document.workspace_id == workspace.id, Document.source_sha256 == source_sha256
        )
    )
    if duplicate is not None:
        return duplicate
    display_title = None
    filename = original_filename
    original_data = data
    if is_image:
        try:
            data = await run_in_threadpool(image_to_pdf, data)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        filename = f"{original_filename.rsplit('.', 1)[0]}.pdf"
        display_title = original_filename
    elif not is_pdf:
        try:
            data = await run_in_threadpool(source_to_pdf, data, suffix, original_filename)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        filename = f"{original_filename.rsplit('.', 1)[0]}.pdf"
        display_title = original_filename
    document_id = uuid.uuid4()
    object_key = f"{user.id}/{document_id}/{filename}"
    original_object_key = None if is_pdf else f"{user.id}/{document_id}/original/{original_filename}"
    storage = ObjectStorage()
    try:
        storage.upload_pdf(object_key, data)
        if original_object_key:
            storage.upload(original_object_key, original_data, file.content_type or "application/octet-stream")
    except Exception as exc:
        try:
            storage.remove(object_key)
        except Exception:
            pass
        if original_object_key:
            try:
                storage.remove(original_object_key)
            except Exception:
                pass
        raise HTTPException(status_code=503, detail=f"Document storage error: {str(exc)}") from exc
    document = Document(
        id=document_id,
        owner_id=user.id,
        workspace_id=workspace.id,
        filename=filename,
        object_key=object_key,
        content_type="application/pdf",
        size_bytes=len(data),
        display_title=display_title,
        original_filename=original_filename if original_object_key else None,
        original_object_key=original_object_key,
        original_content_type=file.content_type if original_object_key else None,
        source_sha256=source_sha256,
    )
    session.add(document)
    await activity(
        session, workspace.id, user.id, "source.uploaded", "document", document.id, {"title": display_title or filename}
    )
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
        document.error_message = f"Processing worker offline: {str(exc)}"
        job.status = JobStatus.FAILED
        job.error_message = document.error_message
        await session.commit()
    return document


@router.post("/{document_id}/retry", response_model=ProcessingJobResponse)
async def retry_document(
    document_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
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
    from app.deliverables import activity, ensure_personal_workspace

    workspace = await ensure_personal_workspace(user, session)
    await activity(
        session,
        workspace.id,
        user.id,
        "source.processing_retried",
        "document",
        document.id,
        {"title": document.display_title or document.filename},
    )
    await session.commit()
    await session.refresh(job)
    from app.tasks import process_document

    try:
        task = process_document.delay(str(document.id))
        job.task_id = task.id
        await session.commit()
    except Exception as exc:
        job.status = JobStatus.FAILED
        job.error_message = f"Processing queue unavailable: {str(exc)}"
        document.status = DocumentStatus.FAILED
        document.error_message = job.error_message
        await session.commit()
        raise HTTPException(status_code=503, detail=job.error_message) from exc
    return job


class HTMLTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text_parts: list[str] = []
        self.title: str = ""
        self.in_title: bool = False
        self.in_ignored: bool = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        if tag.lower() in ("script", "style", "nav", "footer", "head", "noscript", "svg"):
            self.in_ignored = True
        elif tag.lower() == "title":
            self.in_title = True

    def handle_endtag(self, tag: str):
        if tag.lower() in ("script", "style", "nav", "footer", "head", "noscript", "svg"):
            self.in_ignored = False
        elif tag.lower() == "title":
            self.in_title = False
        elif tag.lower() in ("p", "h1", "h2", "h3", "h4", "li", "tr", "div", "article", "section"):
            self.text_parts.append("\n")

    def handle_data(self, data: str):
        if self.in_title:
            self.title += data.strip() + " "
        elif not self.in_ignored:
            cleaned = data.strip()
            if cleaned:
                self.text_parts.append(cleaned + " ")


async def _ingest_text_source(
    title: str,
    text_content: str,
    workspace_id: uuid.UUID | None,
    user: User,
    session: AsyncSession,
    original_filename: str | None = None,
    content_type: str = "text/plain",
) -> Document:
    settings = get_settings()
    from app.deliverables import activity, ensure_personal_workspace, workspace_access
    from app.storage import ObjectStorage

    ws_uuid: uuid.UUID | None = None
    if workspace_id is not None and str(workspace_id).strip() != "":
        if str(workspace_id).strip().lower() not in {"null", "undefined"}:
            try:
                ws_uuid = uuid.UUID(str(workspace_id).strip())
            except (ValueError, AttributeError):
                raise HTTPException(status_code=422, detail="Invalid workspace_id")

    if ws_uuid is not None:
        workspace, _ = await workspace_access(ws_uuid, user, session, {"owner", "editor"})
    else:
        workspace = await ensure_personal_workspace(user, session)

    clean_title = safe_filename(title).replace(".pdf", "") or "Untitled Source"
    display_title = title.strip() or "Untitled Source"

    try:
        pdf_data = await run_in_threadpool(text_to_pdf, text_content, display_title)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    raw_bytes = text_content.encode("utf-8")
    source_sha256 = hashlib.sha256(raw_bytes).hexdigest()
    duplicate = await session.scalar(
        select(Document).where(
            Document.owner_id == user.id, Document.workspace_id == workspace.id, Document.source_sha256 == source_sha256
        )
    )
    if duplicate is not None:
        return duplicate

    document_id = uuid.uuid4()
    pdf_filename = f"{clean_title}.pdf"
    orig_name = original_filename or f"{clean_title}.txt"
    object_key = f"{user.id}/{document_id}/{pdf_filename}"
    original_object_key = f"{user.id}/{document_id}/original/{orig_name}"

    storage = ObjectStorage()
    try:
        storage.upload_pdf(object_key, pdf_data)
        storage.upload(original_object_key, raw_bytes, content_type)
    except Exception as exc:
        try:
            storage.remove(object_key)
        except Exception:
            pass
        try:
            storage.remove(original_object_key)
        except Exception:
            pass
        raise HTTPException(status_code=503, detail=f"Document storage error: {str(exc)}") from exc

    document = Document(
        id=document_id,
        owner_id=user.id,
        workspace_id=workspace.id,
        filename=pdf_filename,
        object_key=object_key,
        content_type="application/pdf",
        size_bytes=len(pdf_data),
        display_title=display_title,
        original_filename=orig_name,
        original_object_key=original_object_key,
        original_content_type=content_type,
        source_sha256=source_sha256,
        status=DocumentStatus.UPLOADED,
        page_count=None,
    )
    session.add(document)
    await session.flush()

    await activity(
        session,
        workspace.id,
        user.id,
        "source.added",
        "document",
        document.id,
        {"filename": pdf_filename, "display_title": display_title},
    )

    job = ProcessingJob(
        document_id=document.id,
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
        document.error_message = f"Processing worker offline: {str(exc)}"
        job.status = JobStatus.FAILED
        job.error_message = document.error_message
        await session.commit()

    return document


@router.post("/text", response_model=DocumentResponse, status_code=201)
async def create_text_source(
    payload: TextSourceCreateRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Document:
    return await _ingest_text_source(
        title=payload.title,
        text_content=payload.content,
        workspace_id=payload.workspace_id,
        user=user,
        session=session,
        original_filename=f"{safe_filename(payload.title)}.txt",
        content_type="text/plain",
    )


@router.post("/url", response_model=DocumentResponse, status_code=201)
async def create_url_source(
    payload: UrlSourceCreateRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Document:
    url = payload.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="URL must start with http:// or https://")

    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            }
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            html_text = res.text
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to fetch content from URL: {str(exc)}")

    extractor = HTMLTextExtractor()
    extractor.feed(html_text)
    body_text = "".join(extractor.text_parts).strip()
    page_title = extractor.title.strip() or url.split("/")[-1] or "Web Page"

    if not body_text:
        raise HTTPException(status_code=422, detail="The URL did not contain readable body text")

    content = f"# {page_title}\nSource URL: {url}\n\n{body_text[:120_000]}"
    return await _ingest_text_source(
        title=page_title[:100],
        text_content=content,
        workspace_id=payload.workspace_id,
        user=user,
        session=session,
        original_filename=f"{safe_filename(page_title)}.html",
        content_type="text/html",
    )


@router.post("/youtube", response_model=DocumentResponse, status_code=201)
async def create_youtube_source(
    payload: YouTubeSourceCreateRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Document:
    url = payload.url.strip()
    match = re.search(r"(?:v=|\/|youtu\.be\/)([0-9A-Za-z_-]{11})", url)
    if not match:
        raise HTTPException(status_code=422, detail="Invalid YouTube video URL")

    video_id = match.group(1)
    video_title = f"YouTube Video {video_id}"
    author_name = "YouTube"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
            res = await client.get(oembed_url)
            if res.status_code == 200:
                data = res.json()
                video_title = data.get("title", video_title)
                author_name = data.get("author_name", author_name)
    except Exception:
        pass

    prompt = (
        f"Generate a comprehensive, source-grounded educational overview and transcript breakdown "
        f"for the YouTube video titled '{video_title}' by '{author_name}' (URL: {url}).\n"
        f"Format in markdown with:\n"
        f"1. Executive Summary & Thesis\n"
        f"2. Core Concepts & Topics Explored\n"
        f"3. Transcript Chapters & Key Discussion Points\n"
        f"4. Actionable Key Takeaways & Study Notes"
    )

    try:
        ai_overview = await ai_orchestrator.complete(
            [{"role": "user", "content": prompt}],
            operation="youtube_source_summary",
            temperature=0.3,
        )
    except Exception:
        ai_overview = (
            f"## Executive Summary\n"
            f"This video '{video_title}' by {author_name} presents important insights on the topic.\n\n"
            f"## Reference Link\n"
            f"- Watch Video: {url}\n"
        )

    content = f"# {video_title}\nChannel: {author_name}\nVideo Link: {url}\n\n{ai_overview}"
    return await _ingest_text_source(
        title=video_title[:100],
        text_content=content,
        workspace_id=payload.workspace_id,
        user=user,
        session=session,
        original_filename=f"youtube_{video_id}.txt",
        content_type="text/plain",
    )

