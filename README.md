# Atlas Finance AI

[![Live Demo](https://img.shields.io/badge/demo-live-38B2AC?style=flat-square)](https://atlas-beige-six.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com)

AI-powered finance tooling for SMEs and CA firms — upload a bank statement PDF, get structured transactions, categorized dashboards, and exportable Excel/PDF reports.

## Features

- **PDF ingestion** — Parse bank statements (Meezan, HBL, UBL) into structured transactions
- **Smart categorization** — AI-assisted categories with learning rules from manual edits
- **Dashboard & reports** — Summary views and one-click Excel/PDF export
- **Multi-tenant ready** — Organization-scoped data with JWT auth and audit logs
- **Parser evaluation** — Labeled fixtures and CI gates for extraction accuracy

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15 (Vercel) |
| Backend | FastAPI + RQ worker (Railway / Fly / Render) |
| Database | Supabase Postgres, SQLite, or Docker Postgres |
| Queue | Redis + RQ |
| Storage | S3-compatible (Supabase Storage, MinIO, AWS) |
| AI | Gemini / OpenAI with heuristic fallback |

## Quick start

Docker is optional — local mode uses SQLite and disk storage.

```bash
# Terminal 1 — API
cd apps/api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 — Web
cd apps/web
npm install --legacy-peer-deps
npm run dev
```

Open http://localhost:3000

### With Docker

```bash
cp .env.example .env   # set DATABASE_URL, STORAGE_BACKEND=s3
docker compose up --build
```

Starts Postgres, Redis, MinIO, API (`:8000`), worker, and web (`:3000`).

## Core flow

1. Sign up at `/signup`
2. Upload a bank statement PDF at `/documents`
3. Wait for status `ready`
4. Review and edit categories at `/transactions`
5. View `/dashboard` and export from `/reports`

## Project layout

```
apps/api/     FastAPI backend + RQ worker + Alembic migrations
apps/web/     Next.js frontend
scripts/      Bank parser evaluation and backfill utilities
sample-data/  Public evaluation fixtures (private PDFs gitignored)
```

## Documentation

| Doc | Description |
|-----|-------------|
| [DEPLOY-VERCEL-SUPABASE.md](./DEPLOY-VERCEL-SUPABASE.md) | Production deploy on Vercel + Supabase |
| [DEPLOY.md](./DEPLOY.md) | Docker staging with `docker-compose.staging.yml` |
| [sample-data/bank-eval/README.md](./sample-data/bank-eval/README.md) | Parser fixture schema and eval commands |

## Security

- JWT in httpOnly cookies via Next.js BFF
- All data scoped by `organization_id`
- PDF-only uploads with size caps
- Private object storage with short-lived presigned URLs
- Never commit `.env` — use `.env.example` as a template
