"""Add conversation resources, workflow events, and workspace memory."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0012_workspace_state"
down_revision = "0011_ai_native_workflows"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conversation_resources",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("resource_type", sa.String(length=20), nullable=False),
        sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(length=30), nullable=False, server_default="context"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("conversation_id", "resource_type", "resource_id"),
    )
    op.create_index("ix_conversation_resources_conversation_id", "conversation_resources", ["conversation_id"])
    op.create_index("ix_conversation_resources_resource_id", "conversation_resources", ["resource_id"])

    op.create_table(
        "workflow_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflow_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workflow_events_workflow_id", "workflow_events", ["workflow_id"])
    op.create_index("ix_workflow_events_event_type", "workflow_events", ["event_type"])

    op.create_table(
        "workspace_memories",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "key"),
    )
    op.create_index("ix_workspace_memories_owner_id", "workspace_memories", ["owner_id"])

    op.execute(
        """
        INSERT INTO conversation_resources
            (id, conversation_id, resource_type, resource_id, role)
        SELECT gen_random_uuid(), conversation_id, 'document', document_id, 'context'
        FROM conversation_documents
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("workspace_memories")
    op.drop_table("workflow_events")
    op.drop_table("conversation_resources")
