#!/bin/sh
set -e
cd /app

echo "Starting Atlas API..."
echo "Python path check: $(python -c 'from app.core.config import ROOT, API_DIR; print(ROOT, API_DIR)')"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

echo "Running migrations..."
alembic upgrade head
echo "Migrations OK"

PORT="${PORT:-8000}"
echo "Listening on 0.0.0.0:${PORT}"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
