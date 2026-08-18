import asyncio
import json
import uuid
from datetime import UTC, datetime

from celery import Task
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.celery_app import celery_app
from app.config import get_settings
from app.database import SessionLocal
from app.documents import safe_filename
from app.models import (
    ArtifactVersion,
    Document,
    DocumentChunk,
    DocumentPage,
    DocumentStatus,
    GeneratedArtifact,
    JobStatus,
    ProcessingJob,
    ToolExecution,
    User,
    WorkflowEvent,
    WorkflowRun,
    WorkflowStepRun,
)
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
        job.started_at = datetime.now(UTC)
        persisted_workflow = await session.scalar(
            select(WorkflowRun).where(WorkflowRun.job_id == job.id)
        )
        if persisted_workflow:
            persisted_workflow.status = "running"
            session.add(WorkflowEvent(
                workflow_id=persisted_workflow.id,
                event_type="workflow.started",
                payload={"job_id": str(job.id)},
            ))
            persisted_steps = list(await session.scalars(
                select(WorkflowStepRun).where(
                    WorkflowStepRun.workflow_id == persisted_workflow.id
                )
            ))
            for persisted_step in persisted_steps:
                persisted_step.status = "running"
                execution = await session.scalar(
                    select(ToolExecution).where(ToolExecution.step_id == persisted_step.id)
                )
                if execution:
                    execution.status = "running"
                    execution.started_at = datetime.now(UTC)
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
        job.completed_at = datetime.now(UTC)
        user = await session.get(User, document.owner_id)
        if user is not None:
            from app.deliverables import activity, ensure_personal_workspace
            workspace = await ensure_personal_workspace(user, session)
            await activity(session, workspace.id, user.id, "source.ready", "document", document.id, {"title": document.display_title or document.filename, "page_count": document.page_count})
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
            user = await session.get(User, document.owner_id)
            if user is not None:
                from app.deliverables import activity, ensure_personal_workspace
                workspace = await ensure_personal_workspace(user, session)
                await activity(session, workspace.id, user.id, "source.failed", "document", document.id, {"title": document.display_title or document.filename, "error": message[:300]})
        if job:
            job.status = JobStatus.FAILED
            job.error_message = message[:2000]
            job.retry_count = retries
            job.completed_at = datetime.now(UTC)
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
    ObjectStorage().upload(key, data, content_type)
    from app.deliverables import ensure_personal_workspace
    workspace = await ensure_personal_workspace(user, session)
    artifact = GeneratedArtifact(
        id=identifier,
        owner_id=user.id,
        workspace_id=workspace.id,
        operation=operation,
        filename=filename,
        object_key=key,
        content_type=content_type,
        size_bytes=len(data),
        parameters=parameters,
    )
    session.add(artifact)
    session.add(
        ArtifactVersion(
            artifact_id=identifier,
            version_number=1,
            object_key=key,
            content_type=content_type,
            size_bytes=len(data),
            metadata_json={"operation": operation},
        )
    )
    await session.commit()
    await session.refresh(artifact)
    return artifact


async def _run_operation(job_id: uuid.UUID, task_id: str) -> None:
    async with SessionLocal() as session:
        job = await session.get(ProcessingJob, job_id)
        if job is None or job.owner_id is None:
            raise ValueError("Operation job no longer exists")
        if job.status == JobStatus.CANCELLED:
            return
        user = await session.get(User, job.owner_id)
        if user is None or not user.is_active:
            raise ValueError("Job owner no longer exists or is disabled")
        job.task_id = task_id
        job.status = JobStatus.RUNNING
        job.progress = 10
        job.started_at = datetime.now(UTC)
        await session.commit()

        parameters = dict(job.parameters)
        operation = job.operation

        from app.ai_features import (
            _ready_document,
            compare,
            extract_information,
            quiz,
            summarize,
            translate,
        )
        from app.schemas import (
            ComparisonRequest,
            ExtractionRequest,
            QuizRequest,
            SummaryRequest,
            TranslationRequest,
        )

        document_id = parameters.pop("document_id", None)
        if operation == "ai_create":
            from app.generation import CreateRequest, create_file
            result = await create_file(CreateRequest.model_validate(parameters["request"]), user, session)
            result_kind = "artifact"
        elif operation == "summary":
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
        if job.status == JobStatus.CANCELLED:
            return
        workflow = await session.scalar(select(WorkflowRun).where(WorkflowRun.job_id == job.id))
        if workflow and result_kind == "ai_result":
            payload = result.result
            title = str(payload.get("title") or operation.replace("_", " ").title())
            primary = str(payload.get("content") or payload.get("summary") or payload.get("overview") or "")
            markdown = f"# {title}\n\n{primary}\n\n```json\n{json.dumps(payload, indent=2, ensure_ascii=False)}\n```\n"
            result = await _store(
                f"ai_{operation}",
                f"{operation.replace('_', '-')}.md",
                markdown.encode("utf-8"),
                "text/markdown; charset=utf-8",
                {"ai_result_id": str(result.id), "source": "conversation_workflow"},
                user,
                session,
            )
            result_kind = "artifact"
        job.status = JobStatus.COMPLETED
        job.progress = 100
        job.completed_at = datetime.now(UTC)
        job.result_kind = result_kind
        job.result_id = result.id
        if workflow:
            workflow.status = "completed"
            session.add(WorkflowEvent(
                workflow_id=workflow.id,
                event_type="workflow.completed",
                payload={"result_kind": result_kind, "result_id": str(result.id)},
            ))
            completed_steps = list(await session.scalars(
                select(WorkflowStepRun).where(WorkflowStepRun.workflow_id == workflow.id)
            ))
            for completed_step in completed_steps:
                completed_step.status = "completed"
                execution = await session.scalar(
                    select(ToolExecution).where(ToolExecution.step_id == completed_step.id)
                )
                if execution:
                    execution.status = "completed"
                    execution.outputs = {
                        "result_kind": result_kind,
                        "result_id": str(result.id),
                    }
                    execution.completed_at = datetime.now(UTC)
        from app.notifications import notify_user
        from app.schemas import UserPreferences
        preferences = UserPreferences.model_validate(user.preferences or {})
        if preferences.notify_processing_completed:
            await notify_user(
                session,
                user.id,
                "job.completed",
                f"{operation.replace('_', ' ').title()} is ready",
                "Your background task finished successfully. Open the result when you are ready.",
                severity="success",
                action="deliverables" if result_kind == "artifact" else "processing",
                subject_type=result_kind,
                subject_id=result.id,
                metadata={"job_id": str(job.id), "operation": operation},
            )
        await session.commit()


async def _fail_operation(job_id: uuid.UUID, message: str, retries: int) -> None:
    async with SessionLocal() as session:
        job = await session.get(ProcessingJob, job_id)
        if job is None:
            return
        job.status = JobStatus.FAILED
        job.error_message = message[:2000]
        job.retry_count = retries
        job.completed_at = datetime.now(UTC)
        workflow = await session.scalar(select(WorkflowRun).where(WorkflowRun.job_id == job.id))
        if workflow:
            workflow.status = "failed"
            session.add(WorkflowEvent(
                workflow_id=workflow.id,
                event_type="workflow.failed",
                payload={"message": message[:500]},
            ))
            failed_step = await session.scalar(
                select(WorkflowStepRun)
                .where(WorkflowStepRun.workflow_id == workflow.id, WorkflowStepRun.status == "running")
                .order_by(WorkflowStepRun.position)
            )
            if failed_step:
                failed_step.status = "failed"
                execution = await session.scalar(
                    select(ToolExecution).where(ToolExecution.step_id == failed_step.id)
                )
                if execution:
                    execution.status = "failed"
                    execution.error_message = message[:2000]
                    execution.completed_at = datetime.now(UTC)
        if job.owner_id is not None:
            owner = await session.get(User, job.owner_id)
            if owner is not None:
                from app.notifications import notify_user
                from app.schemas import UserPreferences
                preferences = UserPreferences.model_validate(owner.preferences or {})
                if preferences.notify_processing_failed:
                    await notify_user(
                        session,
                        owner.id,
                        "job.failed",
                        f"{job.operation.replace('_', ' ').title()} failed",
                        message[:500] or "The background task could not be completed.",
                        severity="error",
                        action="processing",
                        subject_type="job",
                        subject_id=job.id,
                        metadata={"job_id": str(job.id), "operation": job.operation},
                    )
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
