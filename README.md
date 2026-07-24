# InsightPDF

InsightPDF is an intelligent PDF workspace. This repository currently contains the completed **Phase 1 foundation**: a polished React client, FastAPI API, PostgreSQL authentication data, refresh-token rotation, private MinIO storage, secure PDF upload, migrations, tests, and a Docker Compose development environment.

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

## Phase 1 API

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/documents`
- `POST /api/v1/documents`

Uploads are accepted only when the extension, MIME type, size, and PDF file signature are valid. Objects are stored under an owner-scoped key and document queries are filtered to the authenticated user.

## Local verification

```bash
cd server
python -m pytest

cd ../client
npm test
npm run build
```

## Scope

AI chat, OCR, background workers, vector search, summaries, comparisons, and PDF transformations belong to later phases in the supplied specification and are deliberately not represented as completed features yet.
