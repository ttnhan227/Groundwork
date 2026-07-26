import asyncio
import uuid
from datetime import datetime, timezone

from celery import Task
from sqlalchemy import delete, select

from app.celery_app import celery_app
from app.config import get_settings
from app.database import SessionLocal
from app.models import Document, DocumentChunk, DocumentPage, DocumentStatus, JobStatus, ProcessingJob, User
from app.processing import ExtractedPage, extract_pages, requires_ocr
from app.rag import chunk_pages, embed_texts
from app.storage import ObjectStorage


async def _set_running(document_id: uuid.UUID, task_id: str) -> str:
    async with SessionLocal() as session:
        document = await session.get(Document, document_id)
        job = await session.scalar(select(ProcessingJob).where(ProcessingJob.document_id == document_id).order_by(ProcessingJob.created_at.desc()))
        if document is None or job is None:
            raise ValueError("Document or processing job no longer exists")
        document.status = DocumentStatus.EXTRACTING
        job.task_id = task_id
        job.status = JobStatus.RUNNING
        job.progress = 5
        job.started_at = datetime.now(timezone.utc)
        await session.commit()
        return document.object_key


async def _complete(document_id: uuid.UUID, pages: list[ExtractedPage]) -> None:
    async with SessionLocal() as session:
        document = await session.get(Document, document_id)
        job = await session.scalar(select(ProcessingJob).where(ProcessingJob.document_id == document_id).order_by(ProcessingJob.created_at.desc()))
        if document is None or job is None:
            return
        await session.execute(delete(DocumentPage).where(DocumentPage.document_id == document_id))
        session.add_all([
            DocumentPage(document_id=document_id, page_number=p.page_number, text=p.text, extraction_method=p.method)
            for p in pages
        ])
        document.page_count = len(pages)
        document.status = DocumentStatus.INDEXING
        job.progress = 70
        await session.commit()

    settings = get_settings()
    chunks = chunk_pages([(page.page_number, page.text) for page in pages], settings.chunk_size, settings.chunk_overlap)
    vectors = embed_texts([chunk.text for chunk in chunks])

    async with SessionLocal() as session:
        document = await session.get(Document, document_id)
        job = await session.scalar(select(ProcessingJob).where(ProcessingJob.document_id == document_id).order_by(ProcessingJob.created_at.desc()))
        if document is None or job is None:
            return
        await session.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
        session.add_all([
            DocumentChunk(
                document_id=document_id,
                page_number=chunk.page_number,
                chunk_index=chunk.chunk_index,
                text=chunk.text,
                embedding=vector,
            )
            for chunk, vector in zip(chunks, vectors, strict=True)
        ])
        document.status = DocumentStatus.READY
        document.error_message = None
        job.status = JobStatus.COMPLETED
        job.progress = 100
        job.completed_at = datetime.now(timezone.utc)
        await session.commit()


async def _set_ocr_processing(document_id: uuid.UUID) -> None:
    async with SessionLocal() as session:
        document = await session.get(Document, document_id)
        job = await session.scalar(
            select(ProcessingJob)
            .where(ProcessingJob.document_id == document_id)
            .order_by(ProcessingJob.created_at.desc())
        )
        if document is None or job is None:
            return
        document.status = DocumentStatus.OCR_PROCESSING
        job.progress = 25
        await session.commit()


async def _fail(document_id: uuid.UUID, message: str, retries: int) -> None:
    async with SessionLocal() as session:
        document = await session.get(Document, document_id)
        job = await session.scalar(select(ProcessingJob).where(ProcessingJob.document_id == document_id))
        if document:
            document.status = DocumentStatus.FAILED
            document.error_message = message[:2000]
        if job:
            job.status = JobStatus.FAILED
            job.error_message = message[:2000]
            job.retry_count = retries
            job.completed_at = datetime.now(timezone.utc)
        await session.commit()


@celery_app.task(bind=True, autoretry_for=(ConnectionError,), retry_backoff=True, retry_kwargs={"max_retries": 3})
def process_document(self: Task, document_id: str) -> None:
    identifier = uuid.UUID(document_id)

    async def run() -> None:
        object_key = await _set_running(identifier, self.request.id)
        settings = get_settings()
        pdf_data = ObjectStorage().download(object_key)
        if requires_ocr(pdf_data, settings.ocr_text_density_threshold, settings.max_page_count):
            await _set_ocr_processing(identifier)
        pages = extract_pages(
            pdf_data,
            settings.ocr_text_density_threshold,
            settings.ocr_language,
            settings.max_page_count,
        )
        await _complete(identifier, pages)

    async def run_with_failure_tracking() -> Exception | None:
        try:
            await run()
            return None
        except ConnectionError:
            raise
        except Exception as exc:
            await _fail(identifier, str(exc), self.request.retries)
            return exc

    try:
        failure = asyncio.run(run_with_failure_tracking())
    except ConnectionError:
        raise
    if failure is not None:
        raise failure


async def _run_operation(job_id: uuid.UUID, task_id: str) -> None:
    async with SessionLocal() as session:
        job = await session.get(ProcessingJob, job_id)
        if job is None or job.owner_id is None:
            raise ValueError("Operation job no longer exists")
        user = await session.get(User, job.owner_id)
        if user is None or not user.is_active:
            raise ValueError("Job owner no longer exists or is disabled")
        job.task_id = task_id
        job.status = JobStatus.RUNNING
        job.progress = 10
        job.started_at = datetime.now(timezone.utc)
        await session.commit()

        parameters = dict(job.parameters)
        operation = job.operation

        from app.ai_features import compare, extract_information, quiz, summarize, translate
        from app.pdf_operations import add_page_numbers, compress_pdf, images_to_pdf, watermark_pdf
        from app.pdf_tools import (
            _ready_document,
            _store,
            convert_pdf_to_images,
            delete_pages_route,
            extract_pages_route,
            merge,
            rotate,
            split,
        )
        from app.schemas import (
            ComparisonRequest,
            ExtractionRequest,
            MergeRequest,
            PDFToImagesRequest,
            PageOperationRequest,
            QuizRequest,
            RotateRequest,
            SplitRequest,
            SummaryRequest,
            TranslationRequest,
        )

        document_id = parameters.pop("document_id", None)
        if operation == "summary":
            result = await summarize(uuid.UUID(document_id), SummaryRequest(**parameters), user, session)
            result_kind = "ai_result"
        elif operation == "quiz":
            result = await quiz(uuid.UUID(document_id), QuizRequest(**parameters), user, session)
            result_kind = "ai_result"
        elif operation == "extraction":
            result = await extract_information(
                uuid.UUID(document_id), ExtractionRequest(**parameters), user, session
            )
            result_kind = "ai_result"
        elif operation == "translation":
            result = await translate(
                uuid.UUID(document_id), TranslationRequest(**parameters), user, session
            )
            result_kind = "ai_result"
        elif operation == "comparison":
            result = await compare(ComparisonRequest(**parameters), user, session)
            result_kind = "ai_result"
        elif operation == "merge":
            result = await merge(MergeRequest(**parameters), user, session)
            result_kind = "artifact"
        elif operation == "split":
            result = await split(
                SplitRequest(document_id=uuid.UUID(document_id), **parameters), user, session
            )
            result_kind = "artifact"
        elif operation == "rotate":
            result = await rotate(
                RotateRequest(document_id=uuid.UUID(document_id), **parameters), user, session
            )
            result_kind = "artifact"
        elif operation == "delete_pages":
            result = await delete_pages_route(
                PageOperationRequest(document_id=uuid.UUID(document_id), **parameters), user, session
            )
            result_kind = "artifact"
        elif operation == "extract_pages":
            result = await extract_pages_route(
                PageOperationRequest(document_id=uuid.UUID(document_id), **parameters), user, session
            )
            result_kind = "artifact"
        elif operation == "pdf_to_images":
            result = await convert_pdf_to_images(
                PDFToImagesRequest(document_id=uuid.UUID(document_id), **parameters), user, session
            )
            result_kind = "artifact"
        elif operation == "images_to_pdf":
            staged_keys = parameters.pop("staged_keys")
            storage = ObjectStorage()
            try:
                data = images_to_pdf([storage.download(key) for key in staged_keys])
                result = await _store(
                    "images_to_pdf",
                    "images.pdf",
                    data,
                    "application/pdf",
                    {"image_count": len(staged_keys)},
                    user,
                    session,
                )
            finally:
                for key in staged_keys:
                    try:
                        storage.remove(key)
                    except Exception:
                        continue
            result_kind = "artifact"
        elif operation == "watermark":
            pages = parameters.pop("page_numbers", [])
            staged_image_key = parameters.pop("staged_image_key", None)
            storage = ObjectStorage()
            document = await _ready_document(uuid.UUID(document_id), user, session)
            try:
                data = watermark_pdf(
                    storage.download(document.object_key),
                    parameters.pop("text", None),
                    storage.download(staged_image_key) if staged_image_key else None,
                    pages or None,
                    parameters.pop("position", "center"),
                    parameters.pop("opacity", 0.25),
                    parameters.pop("rotation", 0),
                )
                result = await _store(
                    "watermark",
                    f"{document.filename.removesuffix('.pdf')}-watermarked.pdf",
                    data,
                    "application/pdf",
                    job.parameters,
                    user,
                    session,
                )
            finally:
                if staged_image_key:
                    try:
                        storage.remove(staged_image_key)
                    except Exception:
                        pass
            result_kind = "artifact"
        elif operation in {"compress_pdf", "add_page_numbers"}:
            document = await _ready_document(uuid.UUID(document_id), user, session)
            source = ObjectStorage().download(document.object_key)
            if operation == "compress_pdf":
                data = compress_pdf(source, parameters.pop("preset", "balanced"))
                suffix = "compressed"
            else:
                data = add_page_numbers(
                    source,
                    parameters.pop("page_numbers", None) or None,
                    parameters.pop("position", "bottom_center"),
                    parameters.pop("start_number", 1),
                )
                suffix = "numbered"
            # Verification is deterministic: reopen the generated bytes and ensure
            # the page count is unchanged before publishing the artifact.
            import fitz
            verified = fitz.open(stream=data, filetype="pdf")
            try:
                if verified.page_count != document.page_count:
                    raise ValueError("Generated PDF failed page-count verification")
            finally:
                verified.close()
            result = await _store(
                operation,
                f"{document.filename.removesuffix('.pdf')}-{suffix}.pdf",
                data,
                "application/pdf",
                job.parameters,
                user,
                session,
            )
            result_kind = "artifact"
        elif operation == "workflow":
            import fitz
            from app.pdf_operations import delete_pages, rotate_pages, select_pages

            document = await _ready_document(uuid.UUID(document_id), user, session)
            data = ObjectStorage().download(document.object_key)
            original_size = len(data)
            original_pages = document.page_count or 0
            report_steps = []
            workflow_steps = parameters.pop("steps")
            for index, step in enumerate(workflow_steps, 1):
                tool = step["tool"]
                values = dict(step["parameters"])
                values.pop("document_id", None)
                if tool == "rotate":
                    data = rotate_pages(data, values["page_numbers"], values.get("degrees", 90))
                elif tool == "delete_pages":
                    data = delete_pages(data, values["page_numbers"])
                elif tool == "extract_pages":
                    data = select_pages(data, values["page_numbers"])
                elif tool == "add_page_numbers":
                    data = add_page_numbers(
                        data, values.get("page_numbers") or None,
                        values.get("position", "bottom_center"), values.get("start_number", 1),
                    )
                elif tool == "compress_pdf":
                    data = compress_pdf(data, values.get("preset", "balanced"))
                elif tool == "watermark":
                    data = watermark_pdf(
                        data, values.get("text"), None, None, "center",
                        values.get("opacity", 0.25), 0,
                    )
                else:
                    raise ValueError(f"Tool is not executable in a preparation workflow: {tool}")
                check = fitz.open(stream=data, filetype="pdf")
                try:
                    if check.page_count < 1:
                        raise ValueError(f"{step['title']} produced an empty PDF")
                    report_steps.append({
                        "position": index, "tool": tool, "title": step["title"],
                        "status": "verified", "page_count": check.page_count,
                    })
                finally:
                    check.close()
                job.progress = min(90, 10 + round(index / len(workflow_steps) * 75))
                await session.commit()
            final_pdf = fitz.open(stream=data, filetype="pdf")
            try:
                final_pages = final_pdf.page_count
            finally:
                final_pdf.close()
            change_report = {
                "status": "verified",
                "command": job.parameters["command"],
                "source_document_id": str(document.id),
                "source_filename": document.filename,
                "before": {"size_bytes": original_size, "page_count": original_pages},
                "after": {"size_bytes": len(data), "page_count": final_pages},
                "steps": report_steps,
            }
            result = await _store(
                "workflow",
                f"{document.filename.removesuffix('.pdf')}-prepared.pdf",
                data,
                "application/pdf",
                {**job.parameters, "change_report": change_report},
                user,
                session,
            )
            result_kind = "artifact"
        elif operation == "pdf_to_docx":
            from app.document_conversions import pdf_to_docx

            document = await _ready_document(uuid.UUID(document_id), user, session)
            data = pdf_to_docx(ObjectStorage().download(document.object_key))
            result = await _store(
                "pdf_to_docx",
                f"{document.filename.rsplit('.', 1)[0]}.docx",
                data,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                job.parameters,
                user,
                session,
            )
            result_kind = "artifact"
        elif operation in {"docx_to_pdf", "docx_to_markdown"}:
            from app.document_conversions import docx_to_markdown, docx_to_pdf

            storage = ObjectStorage()
            staged_key = parameters["staged_key"]
            source_filename = str(parameters.get("source_filename", "document.docx"))
            stem = source_filename.rsplit(".", 1)[0]
            source_data = storage.download(staged_key)
            if operation == "docx_to_pdf":
                data = docx_to_pdf(source_data)
                filename = f"{stem}.pdf"
                content_type = "application/pdf"
            else:
                data = docx_to_markdown(source_data)
                filename = f"{stem}.md"
                content_type = "text/markdown; charset=utf-8"
            result = await _store(
                operation,
                filename,
                data,
                content_type,
                {"source_filename": source_filename},
                user,
                session,
            )
            storage.remove(staged_key)
            result_kind = "artifact"
        else:
            raise ValueError(f"Unsupported operation: {operation}")

        await session.refresh(job)
        job.status = JobStatus.COMPLETED
        job.progress = 100
        job.completed_at = datetime.now(timezone.utc)
        job.result_kind = result_kind
        job.result_id = result.id
        await session.commit()


async def _fail_operation(job_id: uuid.UUID, message: str, retries: int) -> None:
    async with SessionLocal() as session:
        job = await session.get(ProcessingJob, job_id)
        if job is None:
            return
        job.status = JobStatus.FAILED
        job.error_message = message[:2000]
        job.retry_count = retries
        job.completed_at = datetime.now(timezone.utc)
        await session.commit()


@celery_app.task(bind=True, autoretry_for=(ConnectionError,), retry_backoff=True, retry_kwargs={"max_retries": 3})
def process_operation(self: Task, job_id: str) -> None:
    """Run a validated AI/PDF operation outside the API process."""
    identifier = uuid.UUID(job_id)
    try:
        asyncio.run(_run_operation(identifier, self.request.id))
    except ConnectionError:
        raise
    except Exception as exc:
        asyncio.run(_fail_operation(identifier, str(exc), self.request.retries))
        raise
