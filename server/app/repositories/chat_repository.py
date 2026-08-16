"""Conversations, Messages, and Chat Resources repository."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models import Conversation, Message, User
from app.repositories.base import BaseRepository


class ChatRepository(BaseRepository[Conversation]):
    """Data access operations for Conversations and Messages."""

    async def list_for_user(self, user: User) -> Sequence[Conversation]:
        result = await self.session.scalars(
            select(Conversation)
            .options(selectinload(Conversation.messages))
            .where(Conversation.user_id == user.id)
            .order_by(Conversation.updated_at.desc())
        )
        return result.all()

    async def get_by_id(self, conversation_id: uuid.UUID, user: User | None = None) -> Conversation | None:
        query = (
            select(Conversation)
            .options(
                selectinload(Conversation.messages),
                selectinload(Conversation.resources),
            )
            .where(Conversation.id == conversation_id)
        )
        if user is not None:
            query = query.where(Conversation.user_id == user.id)
        return await self.session.scalar(query)

    async def create(self, conversation: Conversation) -> Conversation:
        self.session.add(conversation)
        await self.session.commit()
        await self.session.refresh(conversation)
        return conversation

    async def update(self, conversation: Conversation) -> Conversation:
        self.session.add(conversation)
        await self.session.commit()
        await self.session.refresh(conversation)
        return conversation

    async def delete(self, conversation: Conversation) -> None:
        await self.session.delete(conversation)
        await self.session.commit()

    async def add_message(self, message: Message) -> Message:
        self.session.add(message)
        await self.session.commit()
        await self.session.refresh(message)
        return message
