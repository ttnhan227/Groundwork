# InsightPDF

InsightPDF is a portfolio-ready AI PDF workspace demonstrating production-oriented
backend engineering, document processing, retrieval-augmented generation, secure object
storage, asynchronous workers, and practical PDF transformations.

## Highlights

- JWT authentication with rotating hashed refresh tokens and account-status enforcement
- Owner-isolated PDF storage, indexed text, conversations, citations, and generated files
- Celery/Redis upload pipeline with PyMuPDF extraction and Tesseract OCR fallback
- Local Sentence Transformer embeddings stored in PostgreSQL/pgvector
- Multi-document Mistral RAG chat with conversation history and clickable page citations
- Cached summaries, key points, action items, quizzes, translation, extraction, and comparison
- Merge, split, rotate, extract/delete pages, conversions, and text/image watermarks
- PDF.js viewer with thumbnails, text search, zoom, navigation, and citation jumps
- Dashboard, profile/password management, usage statistics, failed-job indicators, and admin controls
- Demo account with text, scanned, and versioned comparison PDFs
- Docker Compose, Nginx, MinIO, migrations, automated tests, and GitHub Actions

## Architecture

```text
Browser -> Nginx -> React client
                 -> FastAPI API -> PostgreSQL + pgvector
                                -> MinIO
                                -> Redis -> Celery worker
                                -> Mistral-compatible LLM
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for flows and design trade-offs.

## Stack

React, TypeScript, PDF.js, FastAPI, Pydantic, SQLAlchemy, Alembic, PostgreSQL,
pgvector, Celery, Redis, MinIO, Sentence Transformers, PyMuPDF, Tesseract, Pillow,
Mistral, Docker Compose, Nginx, pytest, and GitHub Actions.

## Quick start

```bash
cp .env.example .env
# Add LLM_API_KEY and replace secrets
docker compose up --build -d
docker compose ps
```

Open:

- Nginx application: `http://localhost:8080`
- Direct frontend: `http://localhost:3000`
- API documentation: `http://localhost:8000/docs`
- MinIO console: `http://localhost:9001`

Demo credentials:

```text
Email: demo@insightpdf.dev
Password: DemoPassword123!
```

The idempotent startup seed creates a text PDF, a scanned PDF, and two handbook versions.
Change or disable the example demo credentials outside a portfolio environment.

## Configuration

All configuration is environment-based. See `.env.example` for database, Redis, MinIO,
JWT, OCR, embeddings, Mistral, file/page quotas, request limits, AI usage limits, demo,
admin, and CORS settings. Real secrets are excluded by `.gitignore`.

## Verification

Backend:

```bash
docker run --rm insightpdf-api python -m pytest -q
```

Frontend:

```bash
cd client
npm run lint
npm test
npm run test:e2e
```

Live workflows:

```bash
docker compose exec -T api python scripts/live_phase_three_smoke.py
docker compose exec -T api python scripts/live_phase_four_smoke.py
docker compose exec -T api python scripts/live_phase_five_smoke.py
docker compose exec -T api python scripts/live_phase_six_smoke.py
```

These cover indexing/RAG citations, every structured AI feature, every PDF
transformation, secured downloads, demo seeding, dashboard metrics, profile/password
changes, document lifecycle actions, and security headers.

## Security and reliability

- Extension, MIME, signature, size, page-count, and image validation
- Per-user authorization on every document, vector query, conversation, result, and artifact
- Password hashing, JWT validation, refresh-token rotation/revocation, and account disabling
- Redis-backed API rate limiting and configurable daily non-cached AI limits
- Safe filenames and private authenticated downloads
- CORS and security headers at API and Nginx layers
- Prompt-injection boundary instructions and schema-validated structured LLM output
- Background extraction retries and user-triggered retry for failed processing
- Centralized production-safe unexpected-error responses

This project demonstrates production-oriented design; it does not claim legal,
regulatory, or enterprise security certification.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md). CI runs backend lint/tests, frontend lint/tests,
and Docker builds on pushes and pull requests.

## Known scaling extension

Document ingestion is already durable and asynchronous. Structured AI and PDF
transformations intentionally execute synchronously for a simple portfolio demo.
At higher traffic, these endpoints should return job IDs and use the existing
Celery/Redis infrastructure for durable progress, cancellation, and retries.
