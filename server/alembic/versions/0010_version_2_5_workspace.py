"""Add collections and AI document metadata for Version 2.5."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0010_version_2_5_workspace"
down_revision = "0009_unified_artifact_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "collections",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False, server_default="#3154d8"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "name"),
    )
    op.create_index("ix_collections_owner_id", "collections", ["owner_id"])
    op.create_index("ix_collections_created_at", "collections", ["created_at"])
    op.add_column("documents", sa.Column("display_title", sa.String(length=180), nullable=True))
    op.add_column(
        "documents",
        sa.Column("tags", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column("documents", sa.Column("collection_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_documents_collection_id", "documents", ["collection_id"])
    op.create_foreign_key(
        "fk_documents_collection_id", "documents", "collections",
        ["collection_id"], ["id"], ondelete="SET NULL",
    )
    op.add_column("generated_artifacts", sa.Column("collection_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_generated_artifacts_collection_id", "generated_artifacts", ["collection_id"])
    op.create_foreign_key(
        "fk_generated_artifacts_collection_id", "generated_artifacts", "collections",
        ["collection_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_generated_artifacts_collection_id", "generated_artifacts", type_="foreignkey")
    op.drop_index("ix_generated_artifacts_collection_id", table_name="generated_artifacts")
    op.drop_column("generated_artifacts", "collection_id")
    op.drop_constraint("fk_documents_collection_id", "documents", type_="foreignkey")
    op.drop_index("ix_documents_collection_id", table_name="documents")
    op.drop_column("documents", "collection_id")
    op.drop_column("documents", "tags")
    op.drop_column("documents", "display_title")
    op.drop_index("ix_collections_created_at", table_name="collections")
    op.drop_index("ix_collections_owner_id", table_name="collections")
    op.drop_table("collections")
