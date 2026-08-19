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

Add your `LLM_API_KEY` in `.env`.

### 2. Start services

```bash
docker compose up -d --build
```

- Web App: http://localhost:8080
- API Docs: http://localhost:8000/docs
- MinIO Console: http://localhost:9001

## Development & Testing

Backend tests:
```bash
cd server
python -m pytest
```

Frontend build:
```bash
cd client
npm install
npm run build
```

## Documentation

- [Architecture & Constraints](docs/ARCHITECTURE.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Verification Workflow](docs/VERIFICATION_WORKFLOW.md)

## License

MIT
