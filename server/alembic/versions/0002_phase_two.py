"""Phase 2 processing state, pages, and jobs."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE documentstatus ADD VALUE IF NOT EXISTS 'EXTRACTING'")
    op.execute("ALTER TYPE documentstatus ADD VALUE IF NOT EXISTS 'OCR_PROCESSING'")
    op.execute("ALTER TYPE documentstatus ADD VALUE IF NOT EXISTS 'INDEXING'")
    op.execute("ALTER TYPE documentstatus ADD VALUE IF NOT EXISTS 'READY'")
    job_status = postgresql.ENUM("QUEUED", "RUNNING", "COMPLETED", "FAILED", name="jobstatus", create_type=False)
    job_status.create(op.get_bind())
    op.add_column("documents", sa.Column("page_count", sa.Integer(), nullable=True))
    op.add_column("documents", sa.Column("error_message", sa.Text(), nullable=True))
    op.create_table(
        "document_pages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("extraction_method", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("document_id", "page_number"),
    )
    op.create_index("ix_document_pages_document_id", "document_pages", ["document_id"])
    op.create_table(
        "processing_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.String(255), unique=True),
        sa.Column("status", job_status, nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text()),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_processing_jobs_document_id", "processing_jobs", ["document_id"])
    op.create_index("ix_processing_jobs_status", "processing_jobs", ["status"])
    op.create_index("ix_processing_jobs_created_at", "processing_jobs", ["created_at"])


def downgrade() -> None:
    op.drop_table("processing_jobs")
    op.drop_table("document_pages")
    op.drop_column("documents", "error_message")
    op.drop_column("documents", "page_count")
    sa.Enum(name="jobstatus").drop(op.get_bind())
