"""Generalize processing jobs for asynchronous AI and PDF operations."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0007_async_operations"
down_revision = "0006_phase_six"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "processing_jobs",
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "processing_jobs",
        sa.Column(
            "operation",
            sa.String(length=50),
            nullable=False,
            server_default="document_processing",
        ),
    )
    op.add_column(
        "processing_jobs",
        sa.Column("parameters", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column("processing_jobs", sa.Column("result_kind", sa.String(length=30), nullable=True))
    op.add_column(
        "processing_jobs",
        sa.Column("result_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_processing_jobs_owner_id",
        "processing_jobs",
        "users",
        ["owner_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.execute(
        """
        UPDATE processing_jobs AS jobs
        SET owner_id = documents.owner_id
        FROM documents
        WHERE jobs.document_id = documents.id
        """
    )
    op.alter_column("processing_jobs", "document_id", existing_type=postgresql.UUID(), nullable=True)
    op.create_index("ix_processing_jobs_owner_id", "processing_jobs", ["owner_id"])
    op.create_index("ix_processing_jobs_operation", "processing_jobs", ["operation"])


def downgrade() -> None:
    op.execute("DELETE FROM processing_jobs WHERE document_id IS NULL")
    op.alter_column("processing_jobs", "document_id", existing_type=postgresql.UUID(), nullable=False)
    op.drop_index("ix_processing_jobs_operation", table_name="processing_jobs")
    op.drop_index("ix_processing_jobs_owner_id", table_name="processing_jobs")
    op.drop_constraint("fk_processing_jobs_owner_id", "processing_jobs", type_="foreignkey")
    op.drop_column("processing_jobs", "result_id")
    op.drop_column("processing_jobs", "result_kind")
    op.drop_column("processing_jobs", "parameters")
    op.drop_column("processing_jobs", "operation")
    op.drop_column("processing_jobs", "owner_id")
