# InsightPDF

InsightPDF is an AI workspace for understanding and transforming documents. Upload a PDF, ask questions with page-level citations, generate structured insights, or turn natural-language requests into reviewable document workflows.

## What it does

- Chat with one or more PDFs using retrieval-augmented generation
- Generate summaries, reports, quizzes, translations, comparisons, and structured data
- Run OCR on scanned documents and keep answers grounded in source pages
- Create DOCX, PDF, and PowerPoint files from source material
- Merge, split, rotate, compress, watermark, convert, and reorganize PDFs
- Plan multi-step operations from prompts such as “remove page 7, add page numbers, then compress”
- Keep documents, conversations, generated files, and AI results private to each account
- Process ingestion and long-running operations asynchronously with Celery

## Architecture

```text
Browser → Nginx → React client
                → FastAPI
                   ├─ PostgreSQL + pgvector
                   ├─ Redis + Celery
                   ├─ MinIO object storage
                   └─ Mistral/OpenAI-compatible AI API
```

The project runs as one Docker Compose stack with PostgreSQL, pgvector, Redis, MinIO, FastAPI, Celery, React, and Nginx. See [ARCHITECTURE.md](ARCHITECTURE.md) for implementation details.

## Run locally

Requirements: Docker Desktop with Docker Compose.

```bash
cp .env.example .env
# PowerShell: Copy-Item .env.example .env
```

Set a strong `JWT_SECRET`, then configure the AI provider:

```dotenv
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.mistral.ai/v1
LLM_MODEL=mistral-small-latest
```

Build and start the application:

```bash
docker compose up --build -d
docker compose ps
```

Open:

- App: http://localhost:8080
- API docs: http://localhost:8000/docs
- MinIO console: http://localhost:9001

The API automatically applies database migrations and seeds required data during startup.

## Google sign-in

Google login is optional. Create a Google OAuth 2.0 **Web application** client and authorize these local JavaScript origins:

```text
http://localhost:8080
http://localhost:3000
```

Use the same client ID for the frontend and backend:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

The frontend value is embedded at build time. Rebuild after changing it:

```bash
docker compose up --build -d client nginx
```

The backend verifies Google’s signature, issuer, audience, timestamps, and verified-email claim. A small clock-skew tolerance prevents valid tokens from failing when Docker’s VM clock differs by a few seconds.

## AI configuration

Hosted embeddings are enabled by default:

```dotenv
EMBEDDING_PROVIDER=api
EMBEDDING_MODEL=mistral-embed
EMBEDDING_DIMENSIONS=1024
```

Local embeddings are also supported through `server/requirements-local-embeddings.txt` with `EMBEDDING_PROVIDER=local`.

Other limits, OCR settings, storage connections, registration controls, and optional administrator credentials are documented in [.env.example](.env.example).

## Verify

Backend:

```bash
docker compose exec -T api python -m pytest -q
```

Frontend requires Node.js 22+:

```bash
cd client
npm ci
npm run lint
npm test
npm run test:e2e
```

Check the running stack:

```bash
curl --fail http://localhost:8080/health
docker compose ps
```

## Deployment

Use strong credentials, HTTPS, private backing services, and coordinated PostgreSQL/object-storage backups in production. See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment and rollback guidance.

## Current limitations

- Complex PDF-to-DOCX layouts may need manual cleanup.
- Translation returns text or Markdown rather than preserving the original PDF layout.
- Additional OCR languages require their matching Tesseract language packs.
- The project does not claim regulatory or enterprise-security certification.
