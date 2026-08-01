"""Render accidentally nested generated JSON as reader-facing Markdown."""

import json

from alembic import op
import sqlalchemy as sa

from app.generated_text import normalize_document_content, normalize_generated_text


revision = "0019_normalize_generated_text"
down_revision = "0018_verified_deliverables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    suggestions = connection.execute(sa.text("SELECT id, proposed_text FROM ai_suggestions")).mappings()
    for row in suggestions:
        normalized = normalize_generated_text(row["proposed_text"])
        if normalized != row["proposed_text"]:
            connection.execute(
                sa.text("UPDATE ai_suggestions SET proposed_text = :text WHERE id = :id"),
                {"text": normalized, "id": row["id"]},
            )

    for table in ("native_documents", "native_document_versions"):
        documents = connection.execute(sa.text(f"SELECT id, content FROM {table}")).mappings()
        for row in documents:
            normalized, changed = normalize_document_content(row["content"])
            if changed:
                connection.execute(
                    sa.text(f"UPDATE {table} SET content = CAST(:content AS jsonb) WHERE id = :id"),
                    {"content": json.dumps(normalized), "id": row["id"]},
                )


def downgrade() -> None:
    # Reader-facing Markdown cannot be losslessly converted back into the provider's nested JSON shape.
    pass
