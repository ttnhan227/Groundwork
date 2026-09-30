#!/bin/sh
set -eu

echo "Starting Groundwork Local Core on port ${PORT:-8000}..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}"
