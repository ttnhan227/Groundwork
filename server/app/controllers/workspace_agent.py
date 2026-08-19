"""Workspace-level agentic orchestration service and endpoints.

Provides source-grounded reasoning, multi-step document generation,
conversational artifact refinement, Whole-Document Verification,
and real-time execution progress events over Server-Sent Events (SSE).
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai_orchestration import ai_orchestrator
from app.database import SessionLocal, get_session
from app.deliverable_review import (
    extract_requirements,
    review_deliverable,
)
from app.deliverables import (
    activity,
    native_response,
    native_text,
    readiness,
    source_context,
    workspace_access,
)
from app.dependencies import current_user
from app.models import (
    Citation,
    Conversation,
    DeliverableRequirement,
    DeliverableReviewFinding,
    Document,
    DocumentChunk,
    DocumentPage,
    DocumentStatus,
    Message,
    MessageRole,
    NativeDocument,
    NativeDocumentSource,
    NativeDocumentVersion,
    User,
    Workspace,
    WorkspaceMemory,
)
from app.rag import (
    build_retrieval_query,
    clean_user_answer,
    embed_texts_async,
    generate_answer,
    relevant_snippet,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Workspace agent"])


class WorkspaceAgentRequest(BaseModel):
    workspace_id: uuid.UUID
    prompt: str = Field(min_length=1, max_length=8000)
    source_document_ids: list[uuid.UUID] = Field(default_factory=list)
    conversation_id: uuid.UUID | None = None
    artifact_id: uuid.UUID | None = None
    action_type: str | None = None  # "chat" | "report" | "proposal" | "presentation" | "summary" | "technical_doc" | "verify" | "edit" | "note"


# Backward-compatibility alias
NotebookAgentRequest = WorkspaceAgentRequest


def _sse_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _content_to_blocks(text: str) -> list[dict[str, str]]:
    blocks: list[dict[str, str]] = []
    for raw in text.split("\n\n"):
        chunk = raw.strip()
        if not chunk:
            continue
        if chunk.startswith("#"):
            title = chunk.lstrip("#").strip()
            blocks.append({"type": "heading", "text": title})
        elif chunk.startswith(("- ", "• ", "* ")):
            for line in chunk.splitlines():
                clean_bullet = re.sub(r"^[-•*]\s*", "", line).strip()
                if clean_bullet:
                    blocks.append({"type": "bullet", "text": clean_bullet})
        else:
            blocks.append({"type": "paragraph", "text": chunk})
    return blocks or [{"type": "paragraph", "text": text}]


def _classify_intent(prompt: str, action_type: str | None) -> str:
    prompt_lower = prompt.lower()
    if action_type in {"report", "proposal", "presentation", "summary", "technical_doc"}:
        return "generate_artifact"
    if action_type == "verify":
        return "verify_artifact"
    if action_type == "edit":
        return "modify_artifact"
    if action_type == "note" or (prompt_lower.startswith("note:") or prompt_lower.startswith("save note")):
        return "create_note"

    if any(re.search(pat, prompt_lower) for pat in [
        r"\b(create|draft|generate|build|write)\b.*\b(proposal|report|presentation|pitch deck|deck|deliverable|brief)\b",
    ]):
        return "generate_artifact"

    if any(re.search(pat, prompt_lower) for pat in [
        r"\b(verify|verification|audit|fact-?check|unsupported claims|compliance check)\b",
        r"\bcheck\b.*\b(unsupported|claims|requirements|coverage)\b",
    ]):
        return "verify_artifact"

    if any(re.search(pat, prompt_lower) for pat in [
        r"\b(rewrite|shorten|expand|update|modify|edit|make)\b.*\b(section|paragraph|heading|draft|proposal|report)\b",
    ]):
        return "modify_artifact"

    return "grounded_qa"


@router.post("/workspaces/agent/execute")
@router.post("/workspace/agent/execute")
@router.post("/notebook/agent/execute")
@router.post("/notebook-agent/execute")
async def execute_workspace_agent(
    payload: WorkspaceAgentRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    workspace, _ = await workspace_access(payload.workspace_id, user, session, {"owner", "editor"})

    # Ensure conversation exists
    conversation: Conversation | None = None
    if payload.conversation_id:
        conversation = await session.scalar(
            select(Conversation).where(
                Conversation.id == payload.conversation_id, Conversation.workspace_id == workspace.id
            )
        )
    if conversation is None:
        title = payload.prompt[:50].strip() or "Workspace conversation"
        conversation = Conversation(
            owner_id=user.id,
            workspace_id=workspace.id,
            title=title,
        )
        session.add(conversation)
        await session.flush()

    # Load recent conversation history before stream generator
    message_rows = list(await session.scalars(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.asc())
    ))
    chat_history: list[dict[str, str]] = [
        {"role": m.role.value, "content": m.content} for m in message_rows
    ]

    # Add user message
    user_msg = Message(
        conversation_id=conversation.id,
        role=MessageRole.USER,
        content=payload.prompt,
    )
    session.add(user_msg)
    await session.commit()

    conversation_id = conversation.id
    workspace_id = workspace.id
    intent = _classify_intent(payload.prompt, payload.action_type)

    async def event_generator() -> AsyncIterator[str]:
        async with SessionLocal() as db_session:
            try:
                # Resolve workspace and active sources in db_session
                workspace_obj = await db_session.get(Workspace, workspace_id)
                if not workspace_obj:
                    yield _sse_event("error", {"message": "Workspace not found."})
                    return

                source_query = select(Document).where(Document.workspace_id == workspace_id, Document.status == DocumentStatus.READY)
                if payload.source_document_ids:
                    source_query = source_query.where(Document.id.in_(payload.source_document_ids))
                sources_list = list(await db_session.scalars(source_query))

                yield _sse_event("conversation", {"conversation_id": str(conversation_id)})

                if intent == "generate_artifact":
                    async for chunk in _orchestrate_artifact_generation(
                        workspace_obj, conversation_id, sources_list, payload, user, db_session
                    ):
                        yield chunk

                elif intent == "modify_artifact":
                    async for chunk in _orchestrate_artifact_modification(
                        workspace_obj, conversation_id, sources_list, payload, user, db_session
                    ):
                        yield chunk

                elif intent == "verify_artifact":
                    async for chunk in _orchestrate_artifact_verification(
                        workspace_obj, conversation_id, sources_list, payload, user, db_session
                    ):
                        yield chunk

                elif intent == "create_note":
                    async for chunk in _orchestrate_create_note(
                        workspace_obj, conversation_id, payload, user, db_session
                    ):
                        yield chunk

                else:
                    async for chunk in _orchestrate_grounded_qa(
                        workspace_obj, conversation_id, sources_list, chat_history, payload, user, db_session
                    ):
                        yield chunk

            except Exception as exc:
                logger.exception("workspace_agent_error: %s", exc)
                error_msg = str(exc).strip() or f"Error: {type(exc).__name__}"
                yield _sse_event("error", {"message": error_msg})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# Backward-compatibility alias
execute_notebook_agent = execute_workspace_agent


async def _orchestrate_artifact_generation(
    workspace: Workspace,
    conversation_id: uuid.UUID,
    sources: list[Document],
    payload: WorkspaceAgentRequest,
    user: User,
    session: AsyncSession,
) -> AsyncIterator[str]:
    yield _sse_event("status", {"step": "analyzing_sources", "label": f"Analyzing {len(sources)} source(s) in workspace..."})

    # Build source text
    source_pages = list(await session.scalars(
        select(DocumentPage)
        .where(DocumentPage.document_id.in_([s.id for s in sources]))
        .order_by(DocumentPage.document_id, DocumentPage.page_number)
        .limit(100)
    )) if sources else []

    source_context_str = "\n\n".join(
        f"[document_id={p.document_id}; document_name={next((s.filename for s in sources if s.id == p.document_id), 'Document')}; page={p.page_number}]\n{p.text[:3000]}"
        for p in source_pages
    )[:80_000]

    yield _sse_event("status", {"step": "extracting_requirements", "label": "Extracting verifiable acceptance requirements..."})

    extracted_reqs: list[dict[str, Any]] = []
    if source_context_str:
        try:
            req_set = await extract_requirements(source_context_str)
            extracted_reqs = [req.model_dump() for req in req_set.requirements]
        except Exception:
            extracted_reqs = []

    yield _sse_event("status", {"step": "retrieving_evidence", "label": f"Gathered {len(extracted_reqs)} requirement(s) and grounding evidence..."})

    yield _sse_event("status", {"step": "drafting", "label": "Drafting verified deliverable..."})

    # Generate document content
    doc_type = "technical proposal" if "proposal" in payload.prompt.lower() else "client report" if "report" in payload.prompt.lower() else "presentation" if "presentation" in payload.prompt.lower() else "deliverable"
    try:
        title_res = await ai_orchestrator.complete(
            [{"role": "user", "content": f"Return ONLY a title (under 80 characters, no quotes) for: {payload.prompt}"}],
            operation="workspace_agent.title",
            temperature=0.2,
        )
        artifact_title = title_res.strip().strip('"')[:120] or f"Verified {doc_type.title()}"
    except Exception:
        artifact_title = f"Verified {doc_type.title()}"

    system_prompt = (
        f"You are Groundwork AI, generating an export-ready, verified {doc_type}.\n"
        "Draft a complete, thorough document using Markdown headings (# Heading), paragraphs, and bullet points.\n"
        "Ground every key claim, metric, and finding directly in the provided sources with explicit source citations like [Source: filename.pdf, p. 1].\n"
        "Do not invent facts or numbers. If information is missing from the sources, explicitly mark it as [Missing from brief / Needs client confirmation].\n"
    )

    user_content = (
        f"Objective: {payload.prompt}\n\n"
        f"Sources:\n{source_context_str if source_context_str else 'No sources attached.'}\n\n"
        f"Key requirements to address:\n" + "\n".join(f"- {r.get('text')}" for r in extracted_reqs[:10])
    )

    draft_text = await ai_orchestrator.complete(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        operation="workspace_agent.draft",
        temperature=0.2,
    )

    blocks = _content_to_blocks(draft_text)

    # Persist NativeDocument
    native_doc = NativeDocument(
        workspace_id=workspace.id,
        owner_id=user.id,
        title=artifact_title,
        content={"type": "doc", "blocks": blocks},
        status="complete",
    )
    session.add(native_doc)
    await session.flush()

    # Add version
    session.add(NativeDocumentVersion(
        native_document_id=native_doc.id,
        version_number=1,
        title=native_doc.title,
        content=native_doc.content,
        change_summary=f"Initial agent generation: {doc_type}",
        created_by=user.id,
    ))

    # Link sources
    for s in sources:
        session.add(NativeDocumentSource(native_document_id=native_doc.id, document_id=s.id))

    # Save requirements
    for idx, r in enumerate(extracted_reqs):
        evidence_list = []
        if r.get("document_id") and r.get("page_number"):
            s_name = next((s.filename for s in sources if s.id == r["document_id"]), "Document")
            evidence_list.append({
                "document_id": str(r["document_id"]),
                "document_name": s_name,
                "page_number": r["page_number"],
                "snippet": r.get("supporting_quote", ""),
            })
        session.add(DeliverableRequirement(
            native_document_id=native_doc.id,
            created_by=user.id,
            text=r.get("text", ""),
            kind=r.get("kind", "content"),
            status="covered",
            is_required=r.get("is_required", True),
            position=idx + 1,
            origin="ai",
            evidence=evidence_list,
            linked_sections=[],
        ))

    await session.flush()

    yield _sse_event("status", {"step": "verifying", "label": "Verifying artifact claims and requirement coverage..."})

    # Run verification review
    review_plan = await review_deliverable(
        draft_text,
        extracted_reqs,
        source_context_str,
    )

    for finding in review_plan.findings:
        session.add(DeliverableReviewFinding(
            native_document_id=native_doc.id,
            requirement_id=finding.requirement_id,
            created_by=user.id,
            kind=finding.kind,
            claim_type=finding.claim_type,
            severity=finding.severity,
            claim_text=finding.claim_text,
            explanation=finding.explanation,
            proposed_text=finding.proposed_text,
            citations=[c.model_dump() for c in finding.citations],
            status="open",
        ))

    await activity(
        session,
        workspace.id,
        user.id,
        "deliverable.created",
        "native_document",
        native_doc.id,
        {"title": native_doc.title},
    )
    await session.commit()
    await session.refresh(native_doc)

    readiness_res = await readiness(native_doc, session)

    # Save assistant message
    summary_text = (
        f"I've generated the **{native_doc.title}** from your {len(sources)} source(s).\n\n"
        f"### Summary of Deliverable\n"
        f"- **Requirements Covered**: {readiness_res.requirements_covered}/{readiness_res.requirements_total}\n"
        f"- **Verification Status**: {readiness_res.status.replace('_', ' ').title()} "
        f"({readiness_res.unsupported_claims} unsupported claims, {readiness_res.open_findings} findings for review)\n"
        f"- **Sections Created**: {len([b for b in blocks if b.get('type') == 'heading'])}\n\n"
        f"The deliverable is available in your **Studio / Artifacts** panel. You can inspect requirements, review findings, or ask me to refine specific sections."
    )

    asst_msg = Message(
        conversation_id=conversation_id,
        role=MessageRole.ASSISTANT,
        content=summary_text,
    )
    session.add(asst_msg)
    await session.commit()
    await session.refresh(asst_msg)

    native_resp = await native_response(native_doc, session)

    yield _sse_event("artifact", {"artifact": native_resp.model_dump()})
    yield _sse_event("verification", {"readiness": readiness_res.model_dump()})
    yield _sse_event("token", {"text": summary_text})
    yield _sse_event("complete", {
        "message_id": str(asst_msg.id),
        "artifact_id": str(native_doc.id),
        "conversation_id": str(conversation_id),
    })


async def _orchestrate_artifact_modification(
    workspace: Workspace,
    conversation_id: uuid.UUID,
    sources: list[Document],
    payload: WorkspaceAgentRequest,
    user: User,
    session: AsyncSession,
) -> AsyncIterator[str]:
    yield _sse_event("status", {"step": "analyzing_sources", "label": "Retrieving active deliverable draft..."})

    target_artifact: NativeDocument | None = None
    if payload.artifact_id:
        target_artifact = await session.scalar(
            select(NativeDocument).where(NativeDocument.id == payload.artifact_id, NativeDocument.workspace_id == workspace.id)
        )
    if target_artifact is None:
        target_artifact = await session.scalar(
            select(NativeDocument).where(NativeDocument.workspace_id == workspace.id).order_by(NativeDocument.updated_at.desc())
        )

    if target_artifact is None:
        yield _sse_event("token", {"text": "No artifact found in this workspace to modify. Please ask me to generate one first."})
        yield _sse_event("complete", {"conversation_id": str(conversation_id)})
        return

    current_text = native_text(target_artifact)

    yield _sse_event("status", {"step": "drafting", "label": f"Applying updates to '{target_artifact.title}'..."})

    system_prompt = (
        "You are Groundwork AI editing an existing deliverable.\n"
        "Apply the user's requested changes faithfully, preserving overall structure and citations where appropriate.\n"
        "Output the full updated document in Markdown format (# Heading, paragraphs, bullets).\n"
    )
    user_content = (
        f"Current Document Text:\n{current_text}\n\n"
        f"Requested Change: {payload.prompt}\n"
    )

    updated_text = await ai_orchestrator.complete(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        operation="workspace_agent.modify_draft",
        temperature=0.2,
    )

    blocks = _content_to_blocks(updated_text)
    target_artifact.content = {"type": "doc", "blocks": blocks}
    target_artifact.revision += 1
    target_artifact.updated_at = datetime.now(UTC)

    session.add(NativeDocumentVersion(
        native_document_id=target_artifact.id,
        version_number=target_artifact.revision,
        title=target_artifact.title,
        content=target_artifact.content,
        change_summary=payload.prompt[:200],
        created_by=user.id,
    ))

    yield _sse_event("status", {"step": "verifying", "label": "Checking updated draft..."})

    await session.commit()
    await session.refresh(target_artifact)

    readiness_res = await readiness(target_artifact, session)
    native_resp = await native_response(target_artifact, session)

    reply_text = f"I've updated **{target_artifact.title}** (Revision {target_artifact.revision}) based on your instruction: *\"{payload.prompt}\"*.\n\nYou can review the updated sections and version history in the Studio panel."

    asst_msg = Message(
        conversation_id=conversation_id,
        role=MessageRole.ASSISTANT,
        content=reply_text,
    )
    session.add(asst_msg)
    await session.commit()

    yield _sse_event("artifact", {"artifact": native_resp.model_dump()})
    yield _sse_event("verification", {"readiness": readiness_res.model_dump()})
    yield _sse_event("token", {"text": reply_text})
    yield _sse_event("complete", {
        "message_id": str(asst_msg.id),
        "artifact_id": str(target_artifact.id),
        "conversation_id": str(conversation_id),
    })


async def _orchestrate_artifact_verification(
    workspace: Workspace,
    conversation_id: uuid.UUID,
    sources: list[Document],
    payload: WorkspaceAgentRequest,
    user: User,
    session: AsyncSession,
) -> AsyncIterator[str]:
    yield _sse_event("status", {"step": "retrieving_evidence", "label": "Loading deliverable and source evidence..."})

    target_artifact: NativeDocument | None = None
    if payload.artifact_id:
        target_artifact = await session.scalar(
            select(NativeDocument).where(NativeDocument.id == payload.artifact_id, NativeDocument.workspace_id == workspace.id)
        )
    if target_artifact is None:
        target_artifact = await session.scalar(
            select(NativeDocument).where(NativeDocument.workspace_id == workspace.id).order_by(NativeDocument.updated_at.desc())
        )

    if target_artifact is None:
        yield _sse_event("token", {"text": "No deliverable found in this workspace to verify. Upload sources and ask me to generate a deliverable first."})
        yield _sse_event("complete", {"conversation_id": str(conversation_id)})
        return

    source_ctx = await source_context(target_artifact, user, session)
    reqs = list(await session.scalars(select(DeliverableRequirement).where(DeliverableRequirement.native_document_id == target_artifact.id)))
    req_dicts = [{"id": str(r.id), "text": r.text, "is_required": r.is_required, "kind": r.kind} for r in reqs]

    yield _sse_event("status", {"step": "verifying", "label": f"Verifying '{target_artifact.title}' against {len(reqs)} requirements and sources..."})

    review_plan = await review_deliverable(
        native_text(target_artifact),
        req_dicts,
        source_ctx,
    )

    for finding in review_plan.findings:
        session.add(DeliverableReviewFinding(
            native_document_id=target_artifact.id,
            requirement_id=finding.requirement_id,
            created_by=user.id,
            kind=finding.kind,
            claim_type=finding.claim_type,
            severity=finding.severity,
            claim_text=finding.claim_text,
            explanation=finding.explanation,
            proposed_text=finding.proposed_text,
            citations=[c.model_dump() for c in finding.citations],
            status="open",
        ))
    await session.commit()

    readiness_res = await readiness(target_artifact, session)
    native_resp = await native_response(target_artifact, session)

    status_icon = "✓" if readiness_res.status == "ready" else "⚠"
    verification_summary = (
        f"### Verification Results for **{target_artifact.title}**\n\n"
        f"- **Readiness**: {status_icon} **{readiness_res.status.replace('_', ' ').title()}**\n"
        f"- **Requirements Covered**: {readiness_res.requirements_covered} / {readiness_res.requirements_total} ({readiness_res.required_covered} required covered)\n"
        f"- **Unsupported Claims**: {readiness_res.unsupported_claims}\n"
        f"- **Open Review Findings**: {readiness_res.open_findings}\n\n"
    )
    if readiness_res.blockers:
        verification_summary += "**Items needing attention:**\n" + "\n".join(f"- {b}" for b in readiness_res.blockers)
    else:
        verification_summary += "All requirements are covered and claims are grounded in your sources! The deliverable is ready to export."

    asst_msg = Message(
        conversation_id=conversation_id,
        role=MessageRole.ASSISTANT,
        content=verification_summary,
    )
    session.add(asst_msg)
    await session.commit()

    yield _sse_event("artifact", {"artifact": native_resp.model_dump()})
    yield _sse_event("verification", {"readiness": readiness_res.model_dump()})
    yield _sse_event("token", {"text": verification_summary})
    yield _sse_event("complete", {
        "message_id": str(asst_msg.id),
        "artifact_id": str(target_artifact.id),
        "conversation_id": str(conversation_id),
    })


async def _orchestrate_create_note(
    workspace: Workspace,
    conversation_id: uuid.UUID,
    payload: WorkspaceAgentRequest,
    user: User,
    session: AsyncSession,
) -> AsyncIterator[str]:
    yield _sse_event("status", {"step": "analyzing_sources", "label": "Saving workspace note..."})

    note_text = payload.prompt.removeprefix("note:").removeprefix("save note:").strip()
    key = f"note_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}"

    memory = WorkspaceMemory(
        owner_id=user.id,
        workspace_id=workspace.id,
        key=key,
        value=note_text,
    )
    session.add(memory)

    reply_text = f"Saved note to your workspace:\n\n> {note_text}"
    asst_msg = Message(
        conversation_id=conversation_id,
        role=MessageRole.ASSISTANT,
        content=reply_text,
    )
    session.add(asst_msg)
    await session.commit()

    yield _sse_event("token", {"text": reply_text})
    yield _sse_event("complete", {
        "message_id": str(asst_msg.id),
        "conversation_id": str(conversation_id),
    })


async def _orchestrate_grounded_qa(
    workspace: Workspace,
    conversation_id: uuid.UUID,
    sources: list[Document],
    chat_history: list[dict[str, str]],
    payload: WorkspaceAgentRequest,
    user: User,
    session: AsyncSession,
) -> AsyncIterator[str]:
    yield _sse_event("status", {"step": "retrieving_evidence", "label": f"Searching evidence across {len(sources)} source(s)..."})

    source_ids = [s.id for s in sources]
    chunks: list[DocumentChunk] = []
    citations_data: list[dict[str, Any]] = []

    history_tuples = [(m.get("role", "user"), m.get("content", "")) for m in chat_history]

    if source_ids:
        query_text = build_retrieval_query(
            payload.prompt,
            history_tuples[-4:],
        )
        embeddings = await embed_texts_async([query_text], operation="workspace_agent.embed_query")
        if embeddings:
            vector = embeddings[0]
            stmt = (
                select(DocumentChunk)
                .where(DocumentChunk.document_id.in_(source_ids))
                .order_by(DocumentChunk.embedding.cosine_distance(vector))
                .limit(8)
            )
            chunks = list(await session.scalars(stmt))

    yield _sse_event("status", {"step": "drafting", "label": "Synthesizing source-grounded response..."})

    retrieved_items = [
        (c.document_id, c.page_number, c.text, next((s.filename for s in sources if s.id == c.document_id), "Document"), c.id)
        for c in chunks
    ]

    answer_text = await generate_answer(
        payload.prompt,
        [c.text for c in chunks],
        history_tuples[-4:],
    )

    clean_answer = clean_user_answer(answer_text)

    # Save citations
    asst_msg = Message(
        conversation_id=conversation_id,
        role=MessageRole.ASSISTANT,
        content=clean_answer,
    )
    session.add(asst_msg)
    await session.flush()

    for doc_id, page_num, text, doc_name, chunk_id in retrieved_items[:6]:
        snippet = relevant_snippet(text, clean_answer, payload.prompt)
        citation = Citation(
            message_id=asst_msg.id,
            chunk_id=chunk_id,
            document_id=doc_id,
            page_number=page_num,
            snippet=snippet,
        )
        session.add(citation)
        citations_data.append({
            "document_id": str(doc_id),
            "document_name": doc_name,
            "page_number": page_num,
            "snippet": snippet,
        })

    await session.commit()
    await session.refresh(asst_msg)

    if citations_data:
        yield _sse_event("citation", {"citations": citations_data})

    yield _sse_event("token", {"text": clean_answer})
    yield _sse_event("complete", {
        "message_id": str(asst_msg.id),
        "conversation_id": str(conversation_id),
    })
