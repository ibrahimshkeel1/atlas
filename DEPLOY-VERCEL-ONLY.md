# Vercel-only Atlas (no Railway)

One Vercel project (`apps/web`) + Supabase (Postgres + Storage).

## 1. Supabase SQL

1. Open Supabase → **SQL** → New query  
2. Paste and run: `apps/web/supabase/schema.sql`  
3. **Storage** → create private bucket `atlas-documents`  
4. **Project Settings → API** → copy:
   - Project URL
   - `service_role` key (secret!)

## 2. Vercel project

1. Import `ibrahimshkeel1/atlas`
2. **Root Directory:** `apps/web`
3. Environment variables:

| Name | Value |
|------|--------|
| `DATABASE_URL` | Supabase **Transaction pooler** URI (port 6543), password filled in, no brackets |
| `JWT_SECRET` | long random (32+ chars) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR_REF.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `S3_BUCKET` | `atlas-documents` |
| `NEXT_PUBLIC_APP_URL` | your Vercel URL (set after first deploy) |

4. Deploy

## 3. What works on Vercel

- Signup / login  
- Upload PDF → extract (Meezan / HBL / UBL text parsers)  
- Documents / transactions / categories / dashboard summary  

## Limits (Vercel serverless)

- No Tesseract OCR (scanned image-only PDFs may fail; digital PDFs work)
- Upload ~4.5MB on Hobby via browser→Vercel; larger may need Pro or direct storage upload later
- Some FastAPI-only pages (eval, full Excel export polish) return 501 until ported

## Local

```bash
cd apps/web
cp ../../.env.production.local .env.local
# add NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm run dev
```
