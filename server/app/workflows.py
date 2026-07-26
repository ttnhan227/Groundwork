import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies import current_user
from app.documents import owned_document
from app.jobs import create_job
from app.models import ProcessingJob, User
from app.schemas import OperationJobCreate, ProcessingJobResponse, WorkflowExecuteRequest, WorkflowPlanRequest, WorkflowPlanResponse, WorkflowStep
from app.tool_registry import TOOL_BY_NAME, public_catalog

router = APIRouter(prefix="/workflows", tags=["Version 2 workflows"])


def _pages(command: str) -> list[int]:
    match = re.search(r"\bpages?\s+((?:\d+\s*(?:,|and|-)?\s*)+)", command, re.I)
    if not match:
        return []
    pages: list[int] = []
    for start, end in re.findall(r"(\d+)(?:\s*-\s*(\d+))?", match.group(1)):
        first, last = int(start), int(end or start)
        if last < first or last - first > 500:
            raise HTTPException(status_code=422, detail="Invalid or excessive page range")
        pages.extend(range(first, last + 1))
    return list(dict.fromkeys(pages))


def build_plan(command: str, document_id: uuid.UUID) -> list[WorkflowStep]:
    text = command.lower()
    selected_pages = _pages(command)
    requested: list[tuple[str, dict]] = []
    if any(word in text for word in ("delete", "remove")) and "page" in text:
        requested.append(("delete_pages", {"page_numbers": selected_pages}))
    if any(word in text for word in ("extract", "keep only")) and "page" in text:
        requested.append(("extract_pages", {"page_numbers": selected_pages}))
    if "rotate" in text:
        degrees = next((value for value in (270, 180, 90) if str(value) in text), 90)
        requested.append(("rotate", {"page_numbers": selected_pages, "degrees": degrees}))
    if any(word in text for word in ("page number", "number the page", "number pages")):
        position = "top_center" if "top" in text else "bottom_center"
        requested.append(("add_page_numbers", {"position": position, "start_number": 1, "page_numbers": selected_pages}))
    if any(word in text for word in ("compress", "smaller", "reduce file size")):
        preset = "strong" if any(word in text for word in ("strong", "smallest", "maximum")) else "basic" if "basic" in text else "balanced"
        requested.append(("compress_pdf", {"preset": preset}))
    if "watermark" in text:
        quoted = re.search(r"""["']([^"']+)["']""", command)
        requested.append(("watermark", {"text": quoted.group(1) if quoted else "CONFIDENTIAL", "opacity": 0.25}))
    if any(word in text for word in ("word document", "docx", "convert to word")):
        requested.append(("pdf_to_docx", {}))
    if any(word in text for word in ("summarize", "summary", "key points")):
        requested.append(("summary", {"style": "key_points" if "key point" in text else "short"}))
    if not requested:
        raise HTTPException(status_code=422, detail="I could not map that request to a supported Version 2 tool.")
    steps = []
    for index, (name, parameters) in enumerate(requested, 1):
        tool = TOOL_BY_NAME[name]
        if name in {"delete_pages", "extract_pages", "rotate"} and not parameters.get("page_numbers"):
            raise HTTPException(status_code=422, detail=f"{tool.title} needs explicit page numbers.")
        steps.append(WorkflowStep(
            id=f"step-{index}", tool=name, title=tool.title,
            parameters={"document_id": str(document_id), **parameters},
            risk=tool.risk, confirmation_required=tool.confirmation == "required",
            verification=tool.verification,
        ))
    return steps


@router.get("/tools")
async def list_tools(_: User = Depends(current_user)) -> dict:
    return {"version": "2.0", "tools": public_catalog()}


@router.post("/plan", response_model=WorkflowPlanResponse)
async def plan_workflow(
    payload: WorkflowPlanRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkflowPlanResponse:
    await owned_document(payload.document_id, user, session)
    steps = build_plan(payload.command, payload.document_id)
    return WorkflowPlanResponse(
        id=uuid.uuid4(), status="proposed", command=payload.command,
        document_id=payload.document_id, steps=steps,
        confirmation_required=any(step.confirmation_required for step in steps),
        estimated_ai_calls=sum(step.tool == "summary" for step in steps),
    )


@router.post("/execute", response_model=ProcessingJobResponse, status_code=202)
async def execute_workflow(
    payload: WorkflowExecuteRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessingJob:
    await owned_document(payload.document_id, user, session)
    steps = build_plan(payload.command, payload.document_id)
    unsupported = [step.title for step in steps if step.tool in {"summary", "pdf_to_docx", "pdf_to_images"}]
    if unsupported:
        raise HTTPException(status_code=422, detail=f"This preparation workflow cannot chain: {', '.join(unsupported)}")
    if any(step.confirmation_required for step in steps) and not payload.approved:
        raise HTTPException(status_code=409, detail="This workflow contains destructive steps and requires approval.")
    return await create_job(
        OperationJobCreate(
            operation="workflow",
            parameters={
                "document_id": str(payload.document_id),
                "command": payload.command,
                "approved": payload.approved,
                "steps": [step.model_dump() for step in steps],
            },
        ),
        user,
        session,
    )
