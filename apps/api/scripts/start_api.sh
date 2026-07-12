#!/bin/sh
set -e
cd /app

echo "Starting Atlas API..."
echo "Python path check: $(python -c 'from app.core.config import ROOT, API_DIR; print(ROOT, API_DIR)')"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

python - <<'PY'
from urllib.parse import urlparse
from app.core.config import get_settings

url = get_settings().resolved_database_url()
p = urlparse(url)
print(f"DB driver/host: {p.scheme}://{p.hostname}:{p.port} db={p.path}")
if not p.hostname:
    raise SystemExit(
        "ERROR: DATABASE_URL has no hostname — remove quotes and fix typos in Railway Variables"
    )
PY

echo "Running migrations..."
alembic upgrade head
echo "Migrations OK"

PORT="${PORT:-8000}"
echo "Listening on 0.0.0.0:${PORT}"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
