#!/bin/sh
set -eu

# Run database migrations and seeding unless explicitly disabled
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    echo "Running database migrations (Alembic)..."
    alembic upgrade head
    echo "Running database seeders..."
    python -m app.seeders.seed
fi

# Optional embedded Celery worker for single-container deployments (e.g. Render)
if [ "${RUN_WORKER:-false}" = "true" ]; then
    echo "Starting embedded Celery worker..."
    celery -A app.tasks.celery_app:celery_app worker \
      --loglevel=INFO \
      --pool=solo \
      --concurrency=1 &
fi

echo "Starting Groundwork API on port ${PORT:-8000}..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}"
