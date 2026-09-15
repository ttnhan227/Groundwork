import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.chat import Message
    from app.models.document import Document
    from app.models.user import User
    from app.models.workspace import Workspace


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(180), default="Untitled Note")
    content: Mapped[str] = mapped_column(Text, default="")
    note_type: Mapped[str] = mapped_column(String(30), default="user", index=True)  # user | saved_answer | excerpt | studio_output
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    citations: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner: Mapped["User"] = relationship()
    workspace: Mapped["Workspace"] = relationship()
    source: Mapped["Document | None"] = relationship()
    message: Mapped["Message | None"] = relationship()
