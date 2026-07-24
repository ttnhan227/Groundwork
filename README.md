# InsightPDF

InsightPDF is an intelligent PDF workspace. Phases 1–3 are implemented: authenticated uploads are processed by Celery, sparse/scanned pages use Tesseract OCR, page text is chunked and embedded locally with Sentence Transformers, vectors are stored in PostgreSQL/pgvector, and persistent RAG conversations return source snippets and clickable page citations in the secured PDF.js viewer.

## Repository structure

```text
InsightPDF/
├── client/          React + TypeScript application
├── server/          FastAPI modular monolith
├── docker-compose.yml
└── .env.example
```

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

Open the app at `http://localhost:3000`, the API at `http://localhost:8000`, API docs at `http://localhost:8000/docs`, and the MinIO console at `http://localhost:9001`.

## Phase 1–3 API

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/documents`
- `POST /api/v1/documents`
- `GET /api/v1/documents/{id}`
- `GET /api/v1/documents/{id}/job`
- `GET /api/v1/documents/{id}/pages`
- `GET /api/v1/documents/{id}/content`
- `GET /api/v1/conversations`
- `POST /api/v1/conversations`
- `PATCH /api/v1/conversations/{id}`
- `DELETE /api/v1/conversations/{id}`
- `POST /api/v1/conversations/{id}/messages`

Uploads are accepted only when the extension, MIME type, size, and PDF file signature are valid. Objects are stored under an owner-scoped key and every document, job, extracted page, vector query, and conversation is filtered to the authenticated user. Set `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` for any OpenAI-compatible chat provider; embeddings remain local and do not consume a paid API.

## Local verification

```bash
cd server
python -m pytest

cd ../client
npm test
npm run build
```

With the Docker stack running, execute the live Phase 1–3 workflow:

```bash
cd server
python scripts/live_phase_three_smoke.py
```

This registers an isolated test user, uploads a generated PDF, waits for extraction and vector indexing, asks one grounded Mistral question, and verifies a Page 1 citation.

## Scope

Summaries, quizzes, structured extraction, comparisons, and PDF transformations belong to later phases in the supplied specification.
