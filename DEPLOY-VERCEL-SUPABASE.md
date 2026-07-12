# Deploy Atlas: Vercel (web) + Supabase (database) + Railway (API)

Atlas cannot run the FastAPI + OCR + RQ worker stack on Vercel serverless.
Use this three-part setup:

| Piece | Platform | Role |
|-------|----------|------|
| Web UI | **Vercel** | Next.js (`apps/web`) |
| Database | **Supabase** | Postgres (+ optional Storage) |
| API + worker | **Railway** (or Fly/Render) | FastAPI, Redis queue, PDF processing |

See also: `.env.production.example` for all variables.

---

## 1. Supabase (database)

1. Create a project at [supabase.com](https://supabase.com).
2. **Settings → Database → Connection string**:
   - Use the **Transaction** pooler URI (port **6543**).
   - Copy it into `DATABASE_URL` for the API host.
3. Atlas accepts `postgres://` / `postgresql://` and rewrites to `postgresql+psycopg://` with `sslmode=require`.
4. (Optional) **Storage**: create a private bucket `atlas-documents`, enable S3 protocol, create access keys.
   - Set `STORAGE_BACKEND=s3` and `S3_*` from the dashboard.

Run migrations from your machine once (or let the API container do it on boot):

```bash
cd apps/api
export DATABASE_URL='postgresql://…pooler.supabase.com:6543/postgres'
source .venv/bin/activate   # or use Docker
alembic upgrade head
```

---

## 2. Redis (for PDF jobs)

Create a Redis instance (Upstash, Redis Cloud, or Railway Redis).

Set on the API/worker:

```bash
REDIS_URL=redis://default:PASSWORD@HOST:PORT
```

Without Redis, uploads fall back to in-request processing (slow; avoid in production).

---

## 3. API + worker on Railway

1. New Railway project → **Deploy from GitHub** (this repo).
2. **Service A — API**
   - Root Directory: `apps/api`
   - Dockerfile: `Dockerfile` (default CMD runs migrations + uvicorn)
   - Generate a public HTTPS domain
3. **Service B — Worker** (same image)
   - Root Directory: `apps/api`
   - Start command: `sh scripts/start_worker.sh`
4. Paste env vars from `.env.production.example` (Supabase `DATABASE_URL`, Redis, JWT secrets, S3, AI keys).
5. Set:
   - `API_PUBLIC_URL=https://YOUR-API.up.railway.app`
   - `API_CORS_ORIGINS=https://YOUR-APP.vercel.app`
   - `REQUIRE_SECURE_SECRETS=true`
   - Strong `JWT_SECRET` and different `FILE_SIGNING_SECRET`

Health check: `GET https://YOUR-API.up.railway.app/health`

---

## 4. Web on Vercel

1. Import the repo in Vercel.
2. **Root Directory:** `apps/web` (important).
3. Framework: Next.js (auto).
4. Environment variables:

| Name | Value |
|------|--------|
| `API_URL` | `https://YOUR-API.up.railway.app` (server-side proxy / SSR) |
| `NEXT_PUBLIC_API_URL` | same URL (browser PDF uploads; bypasses Vercel 4.5MB limit) |
| `NEXT_PUBLIC_APP_URL` | `https://YOUR-APP.vercel.app` |

5. Deploy. Update Railway `API_CORS_ORIGINS` if the Vercel URL changes (preview vs production).

### Why `NEXT_PUBLIC_API_URL`?

Vercel serverless functions reject request bodies over ~4.5MB. Bank statement PDFs often exceed that if uploaded through `/api/proxy`. With `NEXT_PUBLIC_API_URL` set, the Documents page uploads **directly to the API** (using a short-lived token from `/api/auth/access-token`).

---

## 5. Smoke test

1. Open the Vercel URL → Sign up
2. Upload a PDF (Meezan / HBL / UBL sample)
3. Confirm document reaches `ready` (worker must be running)
4. Review transactions → Month close → Export Excel

---

## Architecture

```
Browser ──► Vercel (Next.js)
              │  cookie session + /api/proxy/*
              │  large PDF ──► API directly (NEXT_PUBLIC_API_URL)
              ▼
         Railway API (FastAPI)
              │
              ├── Supabase Postgres
              ├── Redis → RQ Worker (OCR / extract)
              └── S3 / Supabase Storage
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| CORS errors on upload | Add exact Vercel origin to `API_CORS_ORIGINS` |
| Upload fails ~4MB | Set `NEXT_PUBLIC_API_URL` to the API HTTPS URL |
| Docs stuck on `processing` | Worker service down or bad `REDIS_URL` |
| DB SSL / prepare errors | Use pooler port 6543; Atlas sets `prepare_threshold=None` |
| Weak secret boot failure | Set long `JWT_SECRET` + `REQUIRE_SECURE_SECRETS=true` |
