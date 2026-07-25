# InsightPDF Architecture

## System

```text
Browser
  |
Nginx
  |-- React/TypeScript client
  `-- FastAPI REST API
        |-- PostgreSQL + pgvector (accounts, metadata, text, vectors, results)
        |-- MinIO (original PDFs and generated artifacts)
        |-- Redis (Celery broker and rate-limit counters)
        |-- Celery worker (extraction, OCR, chunking, embeddings)
        `-- Mistral-compatible LLM API (RAG and structured AI features)
```

The application is a modular monolith. API routes, schemas, persistence models,
document processing, RAG, storage, AI features, and PDF operations have separate
modules while sharing one deployment boundary.

## Important flows

### Upload and indexing

The API validates the PDF signature, MIME type, extension, size, ownership quota, and
stores the original in MinIO. A Celery task extracts each page with PyMuPDF, uses
Tesseract only when native text is insufficient, creates overlapping chunks, generates
local Sentence Transformer embeddings, stores them in pgvector, and updates progress.

### Grounded chat

The API embeds the current question plus recent conversation context, filters vector
retrieval by owner and selected document IDs, calls Mistral with only retrieved text,
stores the conversation, and returns deduplicated page citations.

### Generated content and PDF tools

Structured AI results are validated with Pydantic and cached by user, documents, feature,
and parameters. AI and PDF requests create owner-scoped processing jobs; Celery workers
execute them, record progress/errors, and attach the stored result or generated artifact.
Multipart images are staged under private UUID keys and removed after processing.
Downloads always pass through an authenticated API endpoint.

## Trade-offs

This is a production-oriented portfolio system, not an enterprise compliance claim.
Document ingestion, AI generation, and JSON-based and multipart PDF operations are durable
Celery jobs. For a larger deployment, route ingestion, embeddings, AI, and transformations
to dedicated queues with independent concurrency and autoscaling limits.
