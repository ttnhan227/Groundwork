import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.database import get_session
from app.dependencies import current_user
from app.models import Citation, Conversation, Document, DocumentChunk, DocumentStatus, Message, MessageRole, User
from app.rag import (
    build_retrieval_query,
    clean_user_answer,
    cited_sources,
    embed_texts,
    generate_answer,
    is_casual_message,
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

router = APIRouter(prefix="/conversations", tags=["RAG chat"])


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

    retrieval_query = build_retrieval_query(payload.question, history)
    query_vector = embed_texts([retrieval_query])[0]
    settings = get_settings()
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
    if not chunks:
        raise HTTPException(status_code=409, detail="The selected documents have no searchable text")
    await record_ai_usage(user, "chat", session)
    try:
        raw_answer = await generate_answer(payload.question, [chunk.text for chunk in chunks], history)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=502, detail="The configured language model is unavailable") from exc
    cited_chunks = cited_sources(raw_answer, chunks, lambda chunk: (chunk.document_id, chunk.page_number))
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
    return ChatResponse(
        answer=answer,
        citations=[
            CitationResponse(
                document_id=chunk.document_id,
                document_name=names[chunk.document_id],
                page_number=chunk.page_number,
                snippet=relevant_snippet(chunk.text, answer, payload.question),
            )
            for chunk in cited_chunks
        ],
    )
