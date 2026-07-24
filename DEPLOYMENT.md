# Deployment

## Required services

- PostgreSQL 16 with pgvector
- Redis
- S3-compatible object storage (MinIO locally)
- API and Celery images built from `server/Dockerfile`
- Client image built from `client/Dockerfile`
- Nginx reverse proxy

## Configuration

Copy `.env.example` to `.env`, replace every secret, and configure the Mistral-compatible
LLM endpoint. Use a strong random JWT secret and non-default database/MinIO credentials.
Set the public frontend origin in `CORS_ORIGINS`.

## Local production-style launch

```bash
docker compose up --build -d
docker compose ps
```

Use `http://localhost:8080` through Nginx. Direct development ports remain available at
3000 and 8000. Database migrations and idempotent demo seeding run before API startup.

## Operational notes

- Persist the PostgreSQL and MinIO volumes and back them up together.
- Terminate TLS before Nginx or add certificates to the proxy.
- Keep PostgreSQL, Redis, and MinIO private.
- Rotate the LLM and JWT secrets if exposed.
- Set strict AI and request limits for a public demo.
- Monitor failed processing jobs and MinIO/PostgreSQL capacity.
- Do not deploy the example credentials unchanged outside a portfolio demo.
