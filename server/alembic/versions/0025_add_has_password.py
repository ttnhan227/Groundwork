"""Add has_password flag to user accounts.

Revision ID: 0025_add_has_password
Revises: 0024_document_source_hash_unique
Create Date: 2026-09-26 21:50:00.000000

"""

from alembic import op
import sqlalchemy as sa

revision = "0025_add_has_password"
down_revision = "0024_document_source_hash_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("has_password", sa.Boolean(), server_default=sa.text("true"), nullable=False))


def downgrade() -> None:
    op.drop_column("users", "has_password")
