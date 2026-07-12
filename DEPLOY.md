# Pilot / staging deploy

For **Vercel + Supabase** production, see [DEPLOY-VERCEL-SUPABASE.md](./DEPLOY-VERCEL-SUPABASE.md).

## Goal

Host a single-tenant staging stack a pilot customer can use (upload statements, review, close month, export).

## Prerequisites

- Docker + Docker Compose
- A VPS or cloud VM (2GB RAM minimum; 4GB preferred)
- Domain (optional but recommended) pointing to the host

## 1. Accuracy check (before inviting a pilot)

From `apps/api`:

```bash
source .venv/bin/activate
python -m scripts.eval_extraction
```

Expect **PASS** on Meezan / HBL / UBL fixtures (F1 ≥ 95%).

Or after login: `GET /api/v1/accuracy/report`.

## Pilot trust pack (P0)

Documents now:
- **Fail** when zero transactions are extracted (status `failed`, not fake `ready`)
- Store **extraction_meta** (method, OCR, dropped rows, balance tie-out)
- Surface **closing balance match/mismatch** on the document
- Offer **Reprocess** in the Documents UI
- Sanitize upload filenames; rate-limit login/signup/upload/export
- Staging requires strong `JWT_SECRET` via `REQUIRE_SECURE_SECRETS=true`

## 2. Configure staging secrets

```bash
cp .env.staging.example .env.staging
# edit JWT_SECRET, POSTGRES_PASSWORD, S3_SECRET_KEY, public URLs
```

## 3. Launch

```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging up --build -d
```

Services:

| Service | Port |
|---------|------|
| Web | 3000 |
| API | 8000 |
| MinIO console | not published by default |

Health: `curl http://localhost:8000/health`

## 4. Pilot checklist

1. Sign up as the pilot org owner
2. Upload one statement per supported bank (Meezan, HBL, UBL)
3. Clear the review queue
4. Close the month
5. Export Excel + PDF
6. Confirm duplicate re-upload is blocked

## 5. Reverse proxy (recommended)

Terminate TLS with Caddy/Nginx:

- `app.example.com` → `web:3000`
- `api.example.com` → `api:8000`

Set `API_PUBLIC_URL`, `API_CORS_ORIGINS`, and `NEXT_PUBLIC_APP_URL` to those HTTPS URLs, then recreate:

```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --force-recreate api web
```

## 6. Backups

- Postgres volume: `postgres_staging_data`
- MinIO volume: `minio_staging_data`

Snapshot both before inviting the pilot.

## Supported banks (parser fixtures)

- **Meezan** — `DD Mon YYYY … ±Rs. amount`
- **HBL** — `YYYY-MM-DD … debit credit balance`
- **UBL** — `DD/MM/YYYY … DR|CR amount balance`

Add a new bank under `sample-data/fixtures/<bank>/` with `statement.txt` + `expected.json`, then a parser in `apps/api/app/services/parsers/`.
