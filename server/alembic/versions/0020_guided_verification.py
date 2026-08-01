"""Add measurable requirement coverage and typed verification claims."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0020_guided_verification"
down_revision = "0019_normalize_generated_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "deliverable_requirements",
        sa.Column("linked_sections", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        "deliverable_review_findings",
        sa.Column("claim_type", sa.String(30), nullable=False, server_default="other"),
    )
    op.create_index("ix_deliverable_review_findings_claim_type", "deliverable_review_findings", ["claim_type"])


def downgrade() -> None:
    op.drop_index("ix_deliverable_review_findings_claim_type", table_name="deliverable_review_findings")
    op.drop_column("deliverable_review_findings", "claim_type")
    op.drop_column("deliverable_requirements", "linked_sections")
