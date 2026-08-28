<p align="center">
  <img src="docs/assets/banner.svg" alt="Groundwork Banner" width="100%">
</p>

<p align="center">
  <strong>An AI-powered document workspace that drafts proposals, reports, and deliverables grounded in your source documents and verifies claims before export.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.12-blue.svg" alt="Python Version">
  <img src="https://img.shields.io/badge/React-19-61dafb.svg" alt="React 19">
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688.svg" alt="FastAPI">
  <img src="https://img.shields.io/badge/PostgreSQL-pgvector-336791.svg" alt="PostgreSQL pgvector">
  <img src="https://github.com/ttnhan227/Groundwork/actions/workflows/ci.yml/badge.svg" alt="CI">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License">
</p>

---

## Platform Visual Preview

| Landing & Verification Simulator | Grounded Authoring Studio & Evidence Rail |
|:---:|:---:|
| ![Groundwork Landing & Simulator](docs/screenshots/groundwork-landing.png) | ![Grounded Studio & Assistant](docs/screenshots/groundwork-studio.png) |
| **Document Library & Compliance Dossiers** | **Regulatory Insights & Citation Audit** |
| ![Document Library & Dossiers](docs/screenshots/groundwork-library.png) | ![Regulatory Insights & Audit](docs/screenshots/groundwork-insights.png) |

---

## DevOps & Infrastructure

Groundwork is containerized and deployed through a full CI/CD pipeline to Google Cloud Run.

### CI/CD Pipeline

```
GitHub (push / pull request)
        │
        ▼
  GitHub Actions
        │
        ├── backend ─── ruff lint + 102 pytest tests
        │                  (includes AST-level data-isolation guard)
        │
        ├── frontend ── ESLint + Vitest unit tests
        │
        ├── docker ──── docker compose build smoke-test
        │               (gated on backend + frontend passing)
        │
        └── e2e ──────── Playwright browser tests against full stack
                         (docker compose up --build)

  On merge to main → deploy.yml
        │
        ├── Build & push to Artifact Registry (with layer caching)
        │
        ├── Deploy API → Cloud Run   ──► POST-deploy /health check
        │
        └── Deploy Worker → Cloud Run Jobs
```

### Services

| Service | Technology | Role |
|---|---|---|
| API | FastAPI + Uvicorn | REST API, SSE streaming, auth |
| Worker | Celery + Redis | PDF OCR, async embedding generation |
| Database | PostgreSQL 16 + pgvector | Relational data + vector search |
| Object Storage | MinIO (S3-compatible) | Uploaded source documents |
| Reverse Proxy | Nginx | TLS termination, routing |
| Frontend | React 19 + Vite | Single-page application |

### Key Infrastructure Decisions

- **Workload Identity Federation** — CI/CD authenticates to GCP without long-lived service account keys
- **Secret Manager** — All credentials injected at runtime via Cloud Run's `--secrets` flag
- **Health-check–gated deploys** — `deploy.yml` calls `GET /health` after each deploy; failures block the workflow
- **Layer-cached Docker builds** — Artifact Registry cache halves average build time
- **Zero-downtime rollout** — Cloud Run traffic-splitting enables instant rollback to any prior revision
- **Multi-stage healthchecks** — Every service in `docker-compose.yml` uses `healthcheck` + `depends_on: condition: service_healthy`

---

## Features

- **Document Ingestion & RAG**: Extract text and page numbers from PDFs with vector search (`pgvector`).
- **Context-Aware AI Assistant**: Drafts and edits sections directly inside the workspace with live context.
- **Traceability & Auditing**: Tracks acceptance requirements and verifies numbers/claims against source pages.
- **Multi-Language Support**: 9 interface languages (English, Vietnamese, Spanish, Japanese, German, French, Chinese, Korean, Portuguese).
- **Export Formats**: Export verified documents to PDF, DOCX, or Markdown.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Backend**: FastAPI, SQLAlchemy Async, Pydantic v2
- **Database & Queue**: PostgreSQL 16 (`pgvector`), Redis 7, Celery
- **Storage**: MinIO (S3-compatible)
- **Infrastructure**: Docker, Docker Compose, Google Cloud Run, GitHub Actions

---

## Getting Started

### 1. Clone repository & configure `.env`

```bash
git clone https://github.com/ttnhan227/Groundwork.git
cd Groundwork
cp .env.example .env
```

Configure your `LLM_API_KEY` and settings in `.env`.

### 2. Start with Docker Compose

```bash
docker compose up -d --build
```

| Endpoint | URL |
|---|---|
| Web Application | http://localhost:8080 |
| API Documentation | http://localhost:8000/docs |
| MinIO Console | http://localhost:9001 |

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

## Testing & Quality Assurance

### Backend Tests

```bash
cd server
python -m pytest tests/ -v
```

102 tests across 19 test files covering:
- Multi-tenant data isolation (AST-level static analysis guard)
- AI orchestration & hallucination detection
- Deliverable generation & verification lifecycle
- Background job processing

### Frontend Tests

```bash
cd client
npm test        # Unit tests (Vitest)
npm run test:e2e  # Playwright end-to-end
```

---

## Local Development (Without Docker)

### Backend & Worker

```bash
cd server
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt

alembic upgrade head
python -m app.seeders.seed

# API server
uvicorn app.main:app --reload --port 8000

# Celery worker (separate terminal)
celery -A app.tasks.celery_app.celery_app worker --loglevel=info
```

### Frontend

```bash
cd client
npm install
npm run dev
```

---

## Documentation

- [System Architecture & Multi-Tenant Isolation](docs/ARCHITECTURE.md)
- [Production Deployment Guide](docs/DEPLOYMENT.md)
- [Troubleshooting Runbook](docs/TROUBLESHOOTING.md)
- [Verification & Audit Workflow](docs/VERIFICATION_WORKFLOW.md)

## License

MIT
