"""Add requirements and structured review findings for verified deliverables."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0018_verified_deliverables"
down_revision = "0017_cancellable_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "deliverable_requirements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("native_document_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("native_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False, server_default="content"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("origin", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("evidence", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    for column in ("native_document_id", "created_by", "kind", "status"):
        op.create_index(f"ix_deliverable_requirements_{column}", "deliverable_requirements", [column])
    op.create_table(
        "deliverable_review_findings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("native_document_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("native_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requirement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("deliverable_requirements.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("claim_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("proposed_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("citations", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    for column in ("native_document_id", "requirement_id", "created_by", "kind", "severity", "status", "created_at"):
        op.create_index(f"ix_deliverable_review_findings_{column}", "deliverable_review_findings", [column])


def downgrade() -> None:
    op.drop_table("deliverable_review_findings")
    op.drop_table("deliverable_requirements")
