"""Add a terminal cancelled state for durable background jobs."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0017_cancellable_jobs"
down_revision = "0016_native_deliverables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'CANCELLED'")
    op.add_column(
        "users",
        sa.Column("preferences", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("users", "preferences")
    # PostgreSQL enum values cannot be removed safely without rebuilding every
    # dependent column. Keeping the unused value is the non-destructive rollback.
    pass
