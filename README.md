# Atlas Finance AI

[![Live Demo](https://img.shields.io/badge/demo-atlas--beige--six.vercel.app-38B2AC?style=flat-square)](https://atlas-beige-six.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com)

Bank statement PDF → structured transactions → categories → dashboard → Excel/PDF reports.

AI-powered finance tooling for SMEs and CA firms — upload a bank statement, get categorized transactions, dashboards, and exportable reports.

## Stack

- **Frontend:** Next.js 15 on **Vercel** (production)
- **Backend:** FastAPI + RQ worker on **Railway** / Fly / Render (not Vercel serverless)
- **DB:** **Supabase** Postgres (or local SQLite / Docker Postgres)
- **Queue:** Redis + RQ
- **Storage:** S3-compatible (Supabase Storage, MinIO, or AWS)
- **AI:** Gemini / OpenAI / heuristic fallback

**Production deploy:** [DEPLOY-VERCEL-SUPABASE.md](./DEPLOY-VERCEL-SUPABASE.md)  
**Docker staging:** [DEPLOY.md](./DEPLOY.md)

## Quick start (no Docker)

Docker is optional. Local mode uses SQLite + disk storage.

```bash
# Terminal 1 — API
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 — Web
cd apps/web
npm install --legacy-peer-deps
npm run dev
```

Open http://localhost:3000

### With Docker (Postgres / Redis / MinIO)

1. Install [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/)
2. Open Docker Desktop and wait until it says **Running**
3. Confirm:

```bash
docker --version
docker compose version
```

4. Set Postgres mode in `.env` (`DATABASE_URL`, `STORAGE_BACKEND=s3`), then:

```bash
docker compose up --build
```

This starts Postgres, Redis, MinIO, API (`:8000`), worker, and web (`:3000`).

### 3. Local frontend (if not using compose web)

```bash
cd apps/web
cp ../../.env.example ../../.env   # if needed
echo "API_URL=http://localhost:8000" > .env.local
npm install --legacy-peer-deps
npm run dev
```

### 4. Local API (without Docker for app processes)

With Postgres/Redis/MinIO already running:

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# separate terminal
python -m app.workers.runner
```

## Accuracy & banks

Bank parser evaluation (Meezan / HBL / UBL) against labeled fixtures:

```bash
# from repo root
python scripts/evaluate_bank_parser.py

# include local private redacted PDFs (never committed)
python scripts/evaluate_bank_parser.py --include-private

# CI gate
cd apps/api && python scripts/evaluate_bank_parser.py --ci
```

Fixture layout and expected JSON schema: [`sample-data/bank-eval/README.md`](./sample-data/bank-eval/README.md).

Public fixtures live under `sample-data/bank-eval/public/`. Real customer PDFs go under `private/` (gitignored) or `ATLAS_BANK_EVAL_PRIVATE_DIR`.

Legacy helpers: `python -m scripts.eval_extraction`. Authenticated API: `GET /api/v1/accuracy/report` and internal Eval UI at `/eval`.

## Multi-client foundation (CA firms)

Schema prep only — no multi-client UI yet.

- `clients` table (org = firm, client = SME)
- Nullable `client_id` on books tables; auth still uses `users.organization_id` only
- Migration: `alembic upgrade head` (`006_clients`, reversible)
- Idempotent backfill: `python -m scripts.backfill_clients`

## Pilot staging

See [DEPLOY.md](./DEPLOY.md) — `docker-compose.staging.yml` + `.env.staging.example`.

## Core flow

1. Sign up at `/signup`
2. Upload a bank statement PDF at `/documents`
3. Wait for status `ready`
4. Review/edit categories at `/transactions` (edits create learning rules)
5. View `/dashboard` and export from `/reports`

## API

Base: `http://localhost:8000/api/v1`

- `POST /auth/signup` `POST /auth/login` `GET /auth/me`
- `GET /dashboard/summary`
- `POST /documents/upload` `GET /documents`
- `GET /transactions` `PATCH /transactions/{id}` `POST /transactions/bulk-category`
- `GET /categories`
- `GET /reports/summary` `POST /reports/export`
- `GET /health`

## Security notes

- JWT in httpOnly cookies via Next BFF
- All data scoped by `organization_id`
- PDFs only, size-capped uploads
- Private S3 keys; downloads via short-lived presigned URLs
- Audit logs for auth, uploads, category edits, exports

## Project layout

```
apps/api   FastAPI backend + RQ worker
apps/web   Next.js app
docker-compose.yml
```
