"""Use 1024-dimensional hosted document embeddings."""

from alembic import op

revision = "0008_hosted_embeddings"
down_revision = "0007_async_operations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding")
    op.execute(
        """
        ALTER TABLE document_chunks
        ALTER COLUMN embedding TYPE vector(1024)
        USING ((embedding::real[] || array_fill(0::real, ARRAY[640]))::vector(1024))
        """
    )
    op.execute(
        """
        CREATE INDEX ix_document_chunks_embedding ON document_chunks
        USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
        """
    )
    op.execute("DELETE FROM document_chunks")
    op.execute(
        """
        UPDATE documents
        SET status = 'FAILED',
            error_message = 'Embedding provider changed. Retry this document to rebuild its index.'
        WHERE status = 'READY'
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding")
    op.execute(
        """
        ALTER TABLE document_chunks
        ALTER COLUMN embedding TYPE vector(384)
        USING (subvector(embedding, 1, 384)::vector(384))
        """
    )
    op.execute(
        """
        CREATE INDEX ix_document_chunks_embedding ON document_chunks
        USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
        """
    )
