"""Add native document lifecycle to persistent workspaces."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0016_native_deliverables"
down_revision = "0015_document_review_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("original_filename", sa.String(255), nullable=True))
    op.add_column("documents", sa.Column("original_object_key", sa.String(500), nullable=True))
    op.add_column("documents", sa.Column("original_content_type", sa.String(100), nullable=True))
    op.add_column("documents", sa.Column("source_sha256", sa.String(64), nullable=True))
    op.create_index("ix_documents_source_sha256", "documents", ["source_sha256"])
    op.create_unique_constraint("uq_documents_original_object_key", "documents", ["original_object_key"])
    op.create_table(
        "native_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("content", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("workspace_id", "owner_id", "status", "created_at"):
        op.create_index(f"ix_native_documents_{column}", "native_documents", [column])

    op.create_table(
        "native_document_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("native_document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("content", postgresql.JSONB(), nullable=False),
        sa.Column("change_summary", sa.String(240), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["native_document_id"], ["native_documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("native_document_id", "version_number"),
    )
    op.create_index("ix_native_document_versions_native_document_id", "native_document_versions", ["native_document_id"])
    op.create_index("ix_native_document_versions_created_by", "native_document_versions", ["created_by"])
    op.create_index("ix_native_document_versions_created_at", "native_document_versions", ["created_at"])

    op.create_table(
        "native_document_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("native_document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["native_document_id"], ["native_documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("native_document_id", "document_id"),
    )
    op.create_index("ix_native_document_sources_native_document_id", "native_document_sources", ["native_document_id"])
    op.create_index("ix_native_document_sources_document_id", "native_document_sources", ["document_id"])

    op.create_table(
        "document_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("native_document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("anchor", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["native_document_id"], ["native_documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("native_document_id", "author_id", "status", "created_at"):
        op.create_index(f"ix_document_comments_{column}", "document_comments", [column])

    op.create_table(
        "ai_suggestions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("native_document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=False),
        sa.Column("before_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("proposed_text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("citations", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["native_document_id"], ["native_documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("native_document_id", "created_by", "status", "created_at"):
        op.create_index(f"ix_ai_suggestions_{column}", "ai_suggestions", [column])

    op.create_table(
        "activity_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("subject_type", sa.String(30), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("workspace_id", "actor_id", "event_type", "subject_id", "created_at"):
        op.create_index(f"ix_activity_events_{column}", "activity_events", [column])


def downgrade() -> None:
    op.drop_table("activity_events")
    op.drop_table("ai_suggestions")
    op.drop_table("document_comments")
    op.drop_table("native_document_sources")
    op.drop_table("native_document_versions")
    op.drop_table("native_documents")
    op.drop_constraint("uq_documents_original_object_key", "documents", type_="unique")
    op.drop_column("documents", "original_content_type")
    op.drop_column("documents", "original_object_key")
    op.drop_column("documents", "original_filename")
    op.drop_index("ix_documents_source_sha256", table_name="documents")
    op.drop_column("documents", "source_sha256")
