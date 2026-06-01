# Provisioning Runbook (E0-12)

> One-time setup to turn the backend from "scaffold" into "buildable + testable." You create the
> accounts and paste keys into `packages/backend/.env` (gitignored, never committed). After that,
> applying migrations, running the catalog ingest, and verifying end-to-end can be automated.
>
> **Cost:** Supabase/TMDB/Sentry/Resend are free tiers. OpenAI needs ~$5 min credit; Anthropic a
> small credit. These small credits are exactly the ≤$5/mo the cost guards protect.

---

## Step 1 — Supabase project (the backbone)
1. supabase.com → **New project**. Region **East US (N. Virginia / `us-east-1`)** (PRD §8). Save the DB password.
2. Project Settings → **API**: copy
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (secret — server only)
3. Project Settings → **Database** → Connection string → **URI**: copy → `SUPABASE_DB_URL`
   (looks like `postgresql://postgres:[PASSWORD]@db.[ref].supabase.co:5432/postgres`).

## Step 2 — TMDB (catalog metadata; free)
1. themoviedb.org → create account → Settings → **API** → request a key (instant, personal use).
2. Copy the **API Read Access Token (v4)** → `TMDB_READ_TOKEN` (preferred). The v3 key → `TMDB_API_KEY` works too.

## Step 3 — OpenAI (embeddings; ~$5 min)
1. platform.openai.com → **API keys** → create → `OPENAI_API_KEY`.
2. Billing → add ~$5 credit (the whole catalog embed is ~$0.30–0.60 one-time).

## Step 4 — Anthropic (the recommender LLM)
1. console.anthropic.com → **API keys** → create → `ANTHROPIC_API_KEY`.
2. Add a small credit. Model is Haiku 4.5; runtime spend is capped at $5/mo by the guards.

## Step 5 — (optional, free) Sentry + Resend
- Sentry: sentry.io → new project (Deno/JS) → copy DSN → `SENTRY_DSN`.
- Resend: resend.com → API key → `RESEND_API_KEY`; set `OWNER_EMAIL` to your address (new-user + daily-digest emails). Skippable for now.

## Step 6 — Write the env file
```
cp packages/backend/.env.example packages/backend/.env
# then paste each value. .env is gitignored — never commit it.
```
Leave `CORS_ALLOWED_ORIGINS` blank for now (filled once the extension has a stable id).
Keep `MONTHLY_BUDGET_USD=5`, `EMBED_COST_CEILING_USD=3`, `BETA_MAX_USERS=10`, `INGEST_TARGET=5000`.

---

## Step 7 — Apply migrations (I can do this for you)
The 6 SQL files in `packages/backend/supabase/migrations/` need to run **in order** against the
project DB. Real Supabase already has the `auth` schema + `auth.users` + `auth.uid()`, so they
apply cleanly (verified locally against pgvector). Two easy paths:
- **Dashboard (no tooling):** Supabase → **SQL Editor** → paste each file `0001…0006` in order → Run.
- **CLI / automated:** with `SUPABASE_DB_URL` set, run each file with `psql` (this is what CI does).
  Once your `.env` exists, **tell me and I'll apply them + verify** (I can drive a postgres client).

(Optional) lock the beta cap explicitly: in SQL Editor run
`alter database postgres set app.beta_max_users = '10';` — otherwise it defaults to 10.

## Step 8 — Run the catalog ingest (start small)
```
cd packages/backend/jobs/catalog-ingest
deno task ingest          # uses ../../.env; embeds INGEST_TARGET titles, aborts above $3
```
Start at `INGEST_TARGET=5000` to validate cheaply (~$0.02), confirm rows land in
`catalog_titles`/`catalog_embeddings`, then raise it for the full international set (~$0.30–0.60).

---

## Verification checklist
- [ ] `.env` has all Supabase keys + `SUPABASE_DB_URL` + TMDB + OpenAI + Anthropic.
- [ ] Migrations 0001–0006 applied (check `select count(*) from catalog_titles;` exists; the
      `trg_enforce_beta_user_cap` trigger is on `auth.users`).
- [ ] Ingest run populated embeddings (`select count(*) from catalog_embeddings;` > 0).
- [ ] (later) Deploy Edge Functions + `supabase secrets set` from `.env`; set `CORS_ALLOWED_ORIGINS`.

## What unlocks once this is done
E3-1 auth, the `/recommend` pipeline (E4), and full end-to-end verification become **buildable and
testable** instead of blind. Hand me the word once `.env` is filled and I'll apply migrations, run
the ingest, and pick up the real backend build.
