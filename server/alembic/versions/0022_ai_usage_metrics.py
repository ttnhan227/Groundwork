"""Add detailed telemetry columns to ai_usage_records.

Revision ID: 0022_ai_usage_metrics
Revises: 0021_account_notifications
Create Date: 2026-09-14 02:25:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0022_ai_usage_metrics"
down_revision = "0021_account_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_usage_records", sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True))
    op.add_column("ai_usage_records", sa.Column("model", sa.String(80), server_default="default", nullable=False))
    op.add_column("ai_usage_records", sa.Column("prompt_tokens", sa.Integer(), server_default="0", nullable=False))
    op.add_column("ai_usage_records", sa.Column("completion_tokens", sa.Integer(), server_default="0", nullable=False))
    op.add_column("ai_usage_records", sa.Column("total_tokens", sa.Integer(), server_default="0", nullable=False))
    op.add_column("ai_usage_records", sa.Column("latency_ms", sa.Integer(), server_default="0", nullable=False))
    op.add_column("ai_usage_records", sa.Column("cost_usd", sa.Float(), server_default="0.0", nullable=False))
    op.add_column("ai_usage_records", sa.Column("idempotency_key", sa.String(128), nullable=True))

    op.create_index("ix_ai_usage_records_workspace_id", "ai_usage_records", ["workspace_id"])
    op.create_index("ix_ai_usage_records_model", "ai_usage_records", ["model"])
    op.create_index("ix_ai_usage_records_idempotency_key", "ai_usage_records", ["idempotency_key"])


def downgrade() -> None:
    op.drop_index("ix_ai_usage_records_idempotency_key", table_name="ai_usage_records")
    op.drop_index("ix_ai_usage_records_model", table_name="ai_usage_records")
    op.drop_index("ix_ai_usage_records_workspace_id", table_name="ai_usage_records")

    op.drop_column("ai_usage_records", "idempotency_key")
    op.drop_column("ai_usage_records", "cost_usd")
    op.drop_column("ai_usage_records", "latency_ms")
    op.drop_column("ai_usage_records", "total_tokens")
    op.drop_column("ai_usage_records", "completion_tokens")
    op.drop_column("ai_usage_records", "prompt_tokens")
    op.drop_column("ai_usage_records", "model")
    op.drop_column("ai_usage_records", "workspace_id")
