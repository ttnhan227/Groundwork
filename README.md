# Groundwork

Groundwork is an AI-first research workspace for ingesting source documents (PDFs, Office files, images, markdown), performing grounded research with citations, and generating verified deliverables like proposals, reports, and briefs.

## Features

- **Research Workspaces**: Conversational research interface with multi-step reasoning, source citations tied to exact pages, and direct deliverable drafting.
- **Document Ingestion & RAG**: Text extraction and OCR across PDF, DOCX, PPTX, XLSX, and images. Semantic search powered by PostgreSQL and pgvector.
- **Generation & Verification**: Export to Markdown, PDF, and Word (.docx) with automated audit checks for requirement coverage and grounded claims.
- **Review & Collaboration**: Inline feedback, requirement tracing, evidence inspection, and version history.

## Architecture

The backend is built with FastAPI in a layered architecture (controllers, services, repositories, models, dtos, tasks), backed by Celery for asynchronous background jobs like OCR and embedding generation.

```
Groundwork/
├── client/                     # React + TypeScript SPA (Vite)
│   └── src/
│       ├── api/                # API client and endpoints
│       ├── components/         # Shared UI components
│       ├── features/           # Feature modules (workspace, landing, account)
│       └── types/              # Type definitions
├── server/                     # FastAPI backend (Python)
│   └── app/
│       ├── configs/            # Configuration and environment settings
│       ├── controllers/        # Route handlers
│       ├── database/           # Database sessions and migrations
│       ├── dtos/               # Request/response schemas
│       ├── middlewares/        # Auth, logging, and error handling
│       ├── models/             # SQLAlchemy ORM models
│       ├── repositories/       # Database access layer
│       ├── seeders/            # Database seed scripts
│       ├── services/           # Business logic, RAG, and LLM orchestration
│       ├── tasks/              # Celery background workers
│       └── utils/              # Helper utilities
└── docker-compose.yml
```

## Tech Stack

- **Frontend**: React, TypeScript, Vite
- **Backend**: FastAPI, Python 3.11, SQLAlchemy 2.0, Pydantic v2
- **Database & Search**: PostgreSQL 16 with pgvector
- **Async Workers**: Celery, Redis
- **Storage**: MinIO (S3-compatible)
- **Proxy**: Nginx

## Getting Started

### Prerequisites

- Docker Desktop with Docker Compose

### 1. Environment Setup

Copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

Set the required environment variables in `.env`:

```dotenv
JWT_SECRET=replace-with-a-strong-secret
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.mistral.ai/v1
LLM_MODEL=mistral-small-latest
```

### 2. Run with Docker Compose

```powershell
docker compose up -d --build
docker compose ps
```

Services will be available at:

- **App**: http://localhost:8080
- **API Docs**: http://localhost:8000/docs
- **MinIO Console**: http://localhost:9001

### 3. Verify

Run backend tests:

```powershell
docker compose exec -T api python -m pytest -q
```

Run frontend tests and build:

```powershell
Set-Location client
npm ci
npm test
npm run lint
npm run build
```

Health check:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8080/health
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for production configuration, backups, and security guidelines.

