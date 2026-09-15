"""Add unique constraint on owner_id, workspace_id, and source_sha256 in documents table.

Revision ID: 0024_document_source_hash_unique
Revises: 0023_notes_table
Create Date: 2026-09-15 18:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0024_document_source_hash_unique"
down_revision = "0023_notes_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_document_source_hash",
        "documents",
        ["owner_id", "workspace_id", "source_sha256"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_document_source_hash", "documents", type_="unique")
