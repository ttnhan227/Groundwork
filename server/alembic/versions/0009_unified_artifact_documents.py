"""Link generated files to their indexed document representation."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0009_unified_artifact_documents"
down_revision = "0008_hosted_embeddings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "generated_artifacts",
        sa.Column("linked_document_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_unique_constraint(
        "uq_generated_artifacts_linked_document_id",
        "generated_artifacts",
        ["linked_document_id"],
    )
    op.create_foreign_key(
        "fk_generated_artifacts_linked_document_id",
        "generated_artifacts",
        "documents",
        ["linked_document_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_generated_artifacts_linked_document_id", "generated_artifacts", type_="foreignkey")
    op.drop_constraint("uq_generated_artifacts_linked_document_id", "generated_artifacts", type_="unique")
    op.drop_column("generated_artifacts", "linked_document_id")
