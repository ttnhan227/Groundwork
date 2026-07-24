"""Phase 4 cached AI document results."""

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_phase_four"
down_revision: str | None = "0003_phase_three"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    feature = sa.Enum("SUMMARY", "QUIZ", "EXTRACTION", "TRANSLATION", "COMPARISON", name="aifeature")
    op.create_table(
        "ai_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("feature", feature, nullable=False),
        sa.Column("cache_key", sa.String(64), nullable=False),
        sa.Column("document_ids", postgresql.JSONB(), nullable=False),
        sa.Column("parameters", postgresql.JSONB(), nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("owner_id", "feature", "cache_key"),
    )
    op.create_index("ix_ai_results_owner_id", "ai_results", ["owner_id"])
    op.create_index("ix_ai_results_feature", "ai_results", ["feature"])
    op.create_index("ix_ai_results_created_at", "ai_results", ["created_at"])


def downgrade() -> None:
    op.drop_table("ai_results")
    op.execute("DROP TYPE IF EXISTS aifeature")
