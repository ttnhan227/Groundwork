"""Create notes table for workspace research notes.

Revision ID: 0023_notes_table
Revises: 0022_ai_usage_metrics
Create Date: 2026-09-15 12:30:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0023_notes_table"
down_revision = "0022_ai_usage_metrics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(180), nullable=False, server_default="Untitled Note"),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("note_type", sa.String(30), nullable=False, server_default="user"),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_title", sa.String(255), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("citations", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_notes_workspace_id", "notes", ["workspace_id"])
    op.create_index("ix_notes_owner_id", "notes", ["owner_id"])
    op.create_index("ix_notes_note_type", "notes", ["note_type"])
    op.create_index("ix_notes_source_id", "notes", ["source_id"])
    op.create_index("ix_notes_message_id", "notes", ["message_id"])
    op.create_index("ix_notes_created_at", "notes", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_notes_created_at", table_name="notes")
    op.drop_index("ix_notes_message_id", table_name="notes")
    op.drop_index("ix_notes_source_id", table_name="notes")
    op.drop_index("ix_notes_note_type", table_name="notes")
    op.drop_index("ix_notes_owner_id", table_name="notes")
    op.drop_index("ix_notes_workspace_id", table_name="notes")
    op.drop_table("notes")
