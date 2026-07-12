#!/bin/sh
set -e
cd /app

echo "Starting Atlas API..."
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

echo "Running migrations..."
alembic upgrade head || {
  echo "Migration failed — check DATABASE_URL / Supabase connectivity"
  exit 1
}

PORT="${PORT:-8000}"
echo "Listening on 0.0.0.0:${PORT}"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
