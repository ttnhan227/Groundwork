# Deployment

## Required services

- PostgreSQL 16 with pgvector
- Redis
- Private S3-compatible object storage
- FastAPI API and Celery worker images built from `server/Dockerfile`
- Client image built from `client/Dockerfile`
- Nginx or an equivalent TLS-terminating reverse proxy

## Production configuration

Copy `.env.example`, then replace every example secret and credential. Required
production decisions include:

- strong random `JWT_SECRET`
- private database, Redis and object-storage credentials
- public HTTPS origins in `CORS_ORIGINS`
- an OpenAI-compatible `LLM_BASE_URL`, key and model
- conservative file, page, document, request and daily AI limits
- whether demo seeding and example credentials remain enabled

Build the client with `VITE_API_URL` when the API is hosted at a separate
origin. Keep the default `/api/v1` when frontend and API share the Nginx origin.

For Render, the repository-level `render.yaml` creates the frontend as a Static
Site with `client` as its root directory and `dist` as its publish directory.
Set `VITE_API_URL` to the public backend URL ending in `/api/v1`.

## Production-style local launch

```bash
docker compose up --build -d
docker compose ps
curl --fail http://localhost:8080/health
```

All listed services should become healthy. The API applies Alembic migrations
and runs the idempotent seed before accepting traffic.

## Release verification

```bash
docker compose exec -T api python -m pytest -q
cd client && npm run lint && npm test && npm run test:e2e
docker compose exec -T api python scripts/live_phase_three_smoke.py
docker compose exec -T api python scripts/live_phase_four_smoke.py
docker compose exec -T api python scripts/live_phase_five_smoke.py
docker compose exec -T api python scripts/live_phase_six_smoke.py
```

## Operational guidance

- Terminate TLS before Nginx and redirect HTTP to HTTPS.
- Keep PostgreSQL, Redis and MinIO on private networks.
- Run API and workers as non-root users in a hardened deployment.
- Back up PostgreSQL and object storage as a coordinated dataset.
- Persist Redis when queued work must survive infrastructure restarts.
- Use separate worker queues/concurrency limits for OCR, embeddings, AI and PDF work.
- Monitor failed jobs, queue depth, request latency, AI usage and storage capacity.
- Rotate LLM, JWT, database and object-storage credentials on exposure.
- Apply a retention policy to staged objects and generated artifacts.
- Do not deploy the example demo/admin passwords outside an intentionally public demo.

## Rollback

Deploy the previous application images first. Only downgrade the database after
reviewing the target migration:

```bash
docker compose exec api alembic history
docker compose exec api alembic downgrade <revision>
```

Database and object-storage backups should be tested before production schema changes.
