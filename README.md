<p align="center">
  <img src="docs/assets/banner.svg" alt="Groundwork Banner" width="100%">
</p>

<p align="center">
  <strong>An AI-powered document workspace that drafts proposals, reports, and deliverables grounded in your source documents and verifies claims before export.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-blue.svg" alt="Python Version">
  <img src="https://img.shields.io/badge/React-19-61dafb.svg" alt="React 19">
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688.svg" alt="FastAPI">
  <img src="https://img.shields.io/badge/PostgreSQL-pgvector-336791.svg" alt="PostgreSQL pgvector">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License">
</p>

---

## Features

- **Document Ingestion & RAG**: Extract text and page numbers from PDFs with vector search (`pgvector`).
- **Context-Aware AI Assistant**: Drafts and edits sections directly inside the workspace with live context.
- **Traceability & Auditing**: Tracks acceptance requirements and verifies numbers/claims against source pages.
- **Multi-Language Support**: 9 interface languages (English, Vietnamese, Spanish, Japanese, German, French, Chinese, Korean, Portuguese).
- **Export Formats**: Export verified documents to PDF, DOCX, or Markdown.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Backend**: FastAPI, SQLAlchemy Async, Pydantic v2
- **Database & Queue**: PostgreSQL (`pgvector`), Redis, Celery
- **Storage**: MinIO (S3-compatible)

## Getting Started

### 1. Clone repository & configure `.env`

```bash
git clone https://github.com/ttnhan227/Groundwork.git
cd Groundwork
cp .env.example .env
```

Configure your `LLM_API_KEY` and settings in `.env`.

### 2. Start with Docker Compose (Recommended)

```bash
docker compose up -d --build
```

- **Web Application**: http://localhost:8080
- **API Documentation**: http://localhost:8000/docs
- **MinIO Console**: http://localhost:9001 (User: `groundwork`, Pass: `groundwork-secret`)

---

## Environment Variables Reference

| Variable | Description | Default / Example |
|---|---|---|
| `ENVIRONMENT` | Runtime environment (`development` or `production`) | `development` |
| `JWT_SECRET` | Secret key for HS256 JWT access tokens (required in prod) | `change-in-production` |
| `DATABASE_URL` | Async PostgreSQL connection string with pgvector | `postgresql+asyncpg://groundwork:groundwork@postgres:5432/groundwork` |
| `REDIS_URL` | Redis URL for Celery broker and rate-limiting | `redis://redis:6379/0` |
| `LLM_API_KEY` | API Key for LLM provider (Gemini or OpenAI compatible) | Required for AI operations |
| `LLM_MODEL` | Target language model for drafting and verification | `gemini-flash-latest` |
| `LLM_BASE_URL` | Base URL for OpenAI-compatible endpoint | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `EMBEDDING_MODEL` | Embedding model for semantic vector search | `gemini-embedding-001` |
| `MINIO_ENDPOINT` | MinIO / S3 endpoint address | `minio:9000` |
| `MINIO_ACCESS_KEY` | Storage access key | `groundwork` |
| `MINIO_SECRET_KEY` | Storage secret key | `groundwork-secret` |
| `MINIO_BUCKET_ORIGINALS` | S3 bucket name for uploaded source documents | `original-documents` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID for backend auth verification | Optional (empty = disabled) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client ID for frontend button initialization | Optional |
| `CORS_ORIGINS` | Comma-separated allowed origins | `http://localhost:5173,http://localhost:3000,http://localhost:8080` |

---

## Local Development (Without Docker)

### Backend & Worker Setup

```bash
cd server
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Run migrations and seed data
alembic upgrade head
python -m app.seeders.seed

# Start FastAPI API server
uvicorn app.main:app --reload --port 8000

# Start Celery async worker (in a separate terminal)
celery -A app.tasks.celery_app.celery_app worker --loglevel=info
```

### Frontend Setup

```bash
cd client
npm install
npm run dev
```

---

## Testing & Quality Assurance

### Run Backend Unit & Integration Tests

```bash
cd server
python -m pytest tests/ -v
```

### Run Frontend Unit Tests & Production Build

```bash
cd client
npm test
```

---

## Documentation

- [System Architecture & Multi-Tenant Isolation](docs/ARCHITECTURE.md)
- [Production Deployment Guide](docs/DEPLOYMENT.md)
- [Verification & Audit Workflow](docs/VERIFICATION_WORKFLOW.md)

## License

MIT
