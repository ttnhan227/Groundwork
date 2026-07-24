import asyncio
import uuid
from datetime import datetime, timezone

from celery import Task
from sqlalchemy import delete, select

from app.celery_app import celery_app
from app.config import get_settings
from app.database import SessionLocal
from app.models import Document, DocumentChunk, DocumentPage, DocumentStatus, JobStatus, ProcessingJob
from app.processing import ExtractedPage, extract_pages
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
        pages = extract_pages(
            ObjectStorage().download(object_key),
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
