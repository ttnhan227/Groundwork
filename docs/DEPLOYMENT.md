# Deployment Guide

This guide covers production deployment, environment setup, and operational guidance for Groundwork.

---

## 1. Required Infrastructure Services

- **PostgreSQL 16** with `pgvector` extension enabled.
- **Redis 7+** (message broker and cache).
- **MinIO / AWS S3** (S3-compatible encrypted object storage for original uploaded documents).
- **FastAPI API & Celery Worker** containers (Python 3.11+).
- **React Client SPA** (built with Vite).
- **Nginx** (TLS termination and reverse proxy).

---

## 2. Environment Configuration

Copy `.env.example` to `.env` and configure your credentials:

```dotenv
ENVIRONMENT=production
JWT_SECRET=replace-with-at-least-32-random-characters
DATABASE_URL=postgresql+asyncpg://user:password@postgres:5432/groundwork
REDIS_URL=redis://redis:6379/0

LLM_API_KEY=your-gemini-or-openai-api-key
LLM_MODEL=gemini-flash-latest
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
EMBEDDING_MODEL=gemini-embedding-001

MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=your-minio-key
MINIO_SECRET_KEY=your-minio-secret
MINIO_BUCKET_ORIGINALS=original-documents

CORS_ORIGINS=https://your-domain.com
```

---

## 3. Quick Docker Launch

```bash
docker compose up --build -d
docker compose ps
curl --fail http://localhost:8080/health
```

---

## 4. Operational Best Practices

- **TLS Termination**: Terminate TLS before Nginx and redirect all HTTP traffic to HTTPS.
- **Network Isolation**: Keep PostgreSQL, Redis, and MinIO on private internal networks.
- **Non-Root Execution**: Run API and Celery workers as non-privileged users.
- **Backup Strategy**: Back up PostgreSQL tables and MinIO object buckets synchronously.
- **Worker Scaling**: Scale Celery worker instances for OCR and embedding workloads during high traffic.
