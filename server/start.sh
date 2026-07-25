#!/bin/sh
set -eu

alembic upgrade head
python -m app.seed

celery -A app.celery_app:celery_app worker \
  --loglevel=INFO \
  --pool=solo \
  --concurrency=1 &

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}"
