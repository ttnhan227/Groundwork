import base64
import uuid

import fitz
import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.database import get_session
from app.dependencies import current_user
from app.models import Citation, Conversation, Document, DocumentChunk, DocumentStatus, Message, MessageRole, User
from app.rag import (
    answer_declines_context,
    build_retrieval_query,
    clean_user_answer,
    cited_sources,
    embed_texts_async,
    generate_answer,
    generate_visual_answer,
    is_casual_message,
    requires_visual_answer,
    relevant_snippet,
)
from app.schemas import (
    ChatRequest,
    ChatResponse,
    CitationResponse,
    ConversationCreate,
    ConversationResponse,
    ConversationUpdate,
    MessageResponse,
)
from app.usage import record_ai_usage
from app.storage import ObjectStorage

router = APIRouter(prefix="/conversations", tags=["RAG chat"])


def _visual_sources(documents: list[Document], limit: int) -> list[tuple[Document, int, str]]:
    sources: list[tuple[Document, int, str]] = []
    storage = ObjectStorage()
    for document in documents:
        pdf = fitz.open(stream=storage.download(document.object_key), filetype="pdf")
        try:
            for index, page in enumerate(pdf):
                if len(sources) >= limit:
                    return sources
                pixmap = page.get_pixmap(matrix=fitz.Matrix(1.35, 1.35), alpha=False)
                encoded = base64.b64encode(pixmap.tobytes("jpeg", jpg_quality=80)).decode("ascii")
                sources.append((document, index + 1, f"data:image/jpeg;base64,{encoded}"))
        finally:
            pdf.close()
    return sources


def serialize(conversation: Conversation) -> ConversationResponse:
    names = {document.id: document.filename for document in conversation.documents}
    return ConversationResponse(
        id=conversation.id,
        title=conversation.title,
        document_ids=list(names),
        messages=[
            MessageResponse(
                id=message.id,
                role=message.role,
                content=clean_user_answer(message.content) if message.role == MessageRole.ASSISTANT else message.content,
                created_at=message.created_at,
                citations=[
                    CitationResponse(
                        document_id=citation.document_id,
                        document_name=names.get(citation.document_id, "Document"),
                        page_number=citation.page_number,
                        snippet=citation.snippet,
                    )
                    for citation in cited_sources(
                        "",
                        message.citations,
                        lambda item: (item.document_id, item.page_number),
                    )
                ],
            )
            for message in conversation.messages
        ],
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


async def owned_conversation(identifier: uuid.UUID, user: User, session: AsyncSession) -> Conversation:
    conversation = await session.scalar(
        select(Conversation)
        .options(
            selectinload(Conversation.documents),
            selectinload(Conversation.messages).selectinload(Message.citations),
        )
        .where(Conversation.id == identifier, Conversation.owner_id == user.id)
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.get("", response_model=list[ConversationResponse])
async def list_conversations(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> list[ConversationResponse]:
    result = await session.scalars(
        select(Conversation)
        .options(
            selectinload(Conversation.documents),
            selectinload(Conversation.messages).selectinload(Message.citations),
        )
        .where(Conversation.owner_id == user.id)
        .order_by(Conversation.updated_at.desc())
    )
    return [serialize(item) for item in result.unique()]


@router.post("", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    payload: ConversationCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ConversationResponse:
    documents = list(await session.scalars(
        select(Document).where(
            Document.id.in_(payload.document_ids),
            Document.owner_id == user.id,
            Document.status == DocumentStatus.READY,
        )
    ))
    if len(documents) != len(set(payload.document_ids)):
        raise HTTPException(status_code=422, detail="Every selected document must be owned by you and ready")
    conversation = Conversation(owner_id=user.id, title=payload.title.strip(), documents=documents)
    session.add(conversation)
    await session.commit()
    return serialize(await owned_conversation(conversation.id, user, session))


@router.patch("/{conversation_id}", response_model=ConversationResponse)
async def rename_conversation(
    conversation_id: uuid.UUID,
    payload: ConversationUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ConversationResponse:
    conversation = await owned_conversation(conversation_id, user, session)
    conversation.title = payload.title.strip()
    await session.commit()
    return serialize(await owned_conversation(conversation_id, user, session))


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_conversation(
    conversation_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    conversation = await owned_conversation(conversation_id, user, session)
    await session.delete(conversation)
    await session.commit()
    return Response(status_code=204)


@router.post("/{conversation_id}/messages", response_model=ChatResponse)
async def ask_question(
    conversation_id: uuid.UUID,
    payload: ChatRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ChatResponse:
    conversation = await owned_conversation(conversation_id, user, session)
    document_ids = [document.id for document in conversation.documents]
    history = [(message.role.value, message.content) for message in conversation.messages]
    if is_casual_message(payload.question):
        answer = "Hello! Ask me anything about this PDF, and I’ll answer using its indexed content."
        session.add_all([
            Message(conversation_id=conversation.id, role=MessageRole.USER, content=payload.question),
            Message(conversation_id=conversation.id, role=MessageRole.ASSISTANT, content=answer),
        ])
        await session.commit()
        return ChatResponse(answer=answer, citations=[])

    settings = get_settings()
    visual_mode = requires_visual_answer(payload.question)
    chunks: list[DocumentChunk] = []
    if not visual_mode:
        retrieval_query = build_retrieval_query(payload.question, history)
        query_vector = (await embed_texts_async([retrieval_query]))[0]
        chunks = list(await session.scalars(
            select(DocumentChunk)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(
                DocumentChunk.document_id.in_(document_ids),
                Document.owner_id == user.id,
            )
            .order_by(DocumentChunk.embedding.cosine_distance(query_vector))
            .limit(settings.rag_top_k)
        ))
        visual_mode = not chunks
    await record_ai_usage(user, "chat", session)
    try:
        visual_sources = _visual_sources(conversation.documents, settings.vision_max_pages) if visual_mode else []
        if visual_mode and not visual_sources:
            raise HTTPException(status_code=409, detail="The selected documents contain no readable pages")
        raw_answer = (
            await generate_visual_answer(
                payload.question,
                [(document.filename, page, data_url) for document, page, data_url in visual_sources],
                history,
            )
            if visual_mode
            else await generate_answer(payload.question, [chunk.text for chunk in chunks], history)
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=502, detail="The configured language model is unavailable") from exc
    cited_chunks = cited_sources(raw_answer, chunks, lambda chunk: (chunk.document_id, chunk.page_number))
    cited_visuals = cited_sources(raw_answer, visual_sources, lambda item: (item[0].id, item[1]))
    if not cited_chunks and not cited_visuals and not answer_declines_context(raw_answer):
        if visual_mode:
            cited_visuals = visual_sources[:1]
        else:
            cited_chunks = chunks[:1]
    answer = clean_user_answer(raw_answer)
    user_message = Message(conversation_id=conversation.id, role=MessageRole.USER, content=payload.question)
    assistant_message = Message(conversation_id=conversation.id, role=MessageRole.ASSISTANT, content=answer)
    session.add_all([user_message, assistant_message])
    await session.flush()
    names = {document.id: document.filename for document in conversation.documents}
    citations = [
        Citation(
            message_id=assistant_message.id,
            chunk_id=chunk.id,
            document_id=chunk.document_id,
            page_number=chunk.page_number,
            snippet=relevant_snippet(chunk.text, answer, payload.question),
        )
        for chunk in cited_chunks
    ]
    session.add_all(citations)
    await session.commit()
    visual_citations = [
        CitationResponse(
            document_id=document.id,
            document_name=document.filename,
            page_number=page_number,
            snippet="Visual analysis of this rendered PDF page.",
        )
        for document, page_number, _ in cited_visuals
    ]
    return ChatResponse(
        answer=answer,
        citations=visual_citations or [
            CitationResponse(
                document_id=chunk.document_id,
                document_name=names[chunk.document_id],
                page_number=chunk.page_number,
                snippet=relevant_snippet(chunk.text, answer, payload.question),
            )
            for chunk in cited_chunks
        ],
    )
