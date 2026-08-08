# Deployment guide

Goal: a **public HTTPS URL** — which is what Amazon Associates requires before
you can apply for PA-API access.

```
Deploy  →  live URL  →  Amazon Associates  →  PA-API keys  →  live Amazon data
```

Docker is deliberately NOT on this path. Railway and Render build Node
monorepos from source with pnpm, where workspace symlinks resolve normally —
which sidesteps the image-packaging problem in
`phase-14-deployment-status.md` entirely. The Dockerfiles remain for later, if
you ever want them.

Everything below has a free tier. Expect ~45 minutes end to end.

---

## STEP 1 — Database (Supabase)

1. **supabase.com** → sign in → **New project**
2. Name `pricetrail`, region **South Asia (Mumbai)** — closest to both
   marketplaces
3. Set a database password and **save it somewhere**; it cannot be recovered,
   only reset
4. Wait ~2 minutes for provisioning
5. **Project Settings → Database → Connection string**, take both:

| Variable | Which string | Why |
|---|---|---|
| `DATABASE_URL` | **Transaction pooler**, port `6543`, add `?pgbouncer=true&connection_limit=1` | Runtime queries. Serverless and multi-replica apps exhaust direct connections fast |
| `DIRECT_URL` | **Direct connection**, port `5432` | Migrations only. PgBouncer in transaction mode cannot run DDL or hold advisory locks |

6. **Enable the extensions.** SQL Editor → New query → run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Without these the very first migration fails — `marketplace_listings`
declares a `vector(384)` column.

---

## STEP 2 — Redis (Upstash)

1. **upstash.com** → **Create Database** → region as close to Mumbai as offered
2. Copy the **`rediss://` connection string** (TLS) → this is `REDIS_URL`

⚠️ **Check the eviction policy is `noeviction`.** Under any other policy Redis
silently deletes keys at the memory limit — and BullMQ stores job state in
ordinary keys, so queued jobs vanish with no error. The API asserts this at
startup and refuses to boot if it is wrong.

---

## STEP 3 — Run migrations against production

From your machine, **once**:

```powershell
cd C:\dev\pricetrail
$env:DATABASE_URL="<supabase pooler url>"
$env:DIRECT_URL="<supabase direct url>"
pnpm --filter @pricetrail/database migrate:deploy
```

Then verify:

```powershell
pnpm --filter @pricetrail/database migrate:status
```

`migrate:deploy`, never `migrate dev` — deploy is non-interactive and never
tries to create a shadow database.

**Do not seed production.** The seed writes fake products with invented
prices; that data would be indistinguishable from real observations later.

---

## STEP 4 — API (Railway)

1. **railway.app** → **New Project → Deploy from GitHub repo** →
   `KUSH-Q-37/pricetrail`
2. **Settings → Build**:
   - Root directory: leave as repo root (it is a monorepo)
   - Build command:
     ```
     pnpm install --frozen-lockfile && pnpm --filter @pricetrail/database generate && pnpm build
     ```
   - Start command:
     ```
     node apps/api/dist/main.js
     ```
3. **Variables** — add these:

```
NODE_ENV=production
PORT=3001
DATABASE_URL=<supabase pooler>
DIRECT_URL=<supabase direct>
REDIS_URL=<upstash rediss://>
APP_TIMEZONE=Asia/Kolkata
TZ=UTC
LOG_LEVEL=info
SWAGGER_ENABLED=false
AUTH_MODE=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
CORS_ORIGINS=<your Vercel URL, added in step 6>
```

⚠️ `AUTH_MODE=local-dev` **cannot** be used here — the env schema refuses to
start when it is combined with `NODE_ENV=production`, because that mode lets
the API mint its own tokens.

4. **Settings → Networking → Generate Domain** → note the URL
5. Confirm: `https://<api-domain>/health/ready` should return
   `{"status":"ok",...}`

---

## STEP 5 — Worker (Railway, second service)

Same repo, **new service** in the same project.

- Build command: same as the API
- Start command: `node apps/worker/dist/main.js`
- Variables: same as the API, **minus** `PORT`, `CORS_ORIGINS`, `SWAGGER_ENABLED`
- Add `SCRAPE_CONCURRENCY=2` (keep it low until you know the memory ceiling)

The worker registers its own repeatable jobs on boot — the daily 02:00 sweep
and monthly partition maintenance — so nothing else needs scheduling.

⚠️ The worker downloads the ~30 MB embedding model on first use. Expect the
first job to be slow.

---

## STEP 6 — Web (Vercel)

1. **vercel.com** → **Add New → Project** → import `KUSH-Q-37/pricetrail`
2. **Root Directory**: `apps/web`
3. Framework preset: **Next.js** (auto-detected)
4. Environment variables:

```
NEXT_PUBLIC_API_URL=https://<railway-api-domain>
NEXT_PUBLIC_AUTH_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Supabase → Settings → API>
```

⚠️ The **anon** key is designed to be public and is safe in the browser bundle.
The **service_role** key must never appear in any `NEXT_PUBLIC_*` variable — it
bypasses row-level security entirely.

5. Deploy → note the URL
6. **Go back to Railway** and set `CORS_ORIGINS` to that exact Vercel URL, then
   redeploy the API. Without this the browser blocks every API call.

---

## STEP 7 — Verify

```
https://<vercel-url>              → login page renders
https://<api-domain>/health/ready → {"status":"ok"}
```

Sign up through the UI (real Supabase auth now — passwords are checked), then
paste a Flipkart product URL. It should go PENDING → READY within a minute as
the worker fetches it.

---

## STEP 8 — Amazon Associates → PA-API

Now you have the URL Amazon asks for.

1. **affiliate-program.amazon.in** → sign up
2. Enter your **Vercel URL** as your website
3. Describe the site honestly: a price-comparison and price-history tracker for
   Indian marketplaces
4. Once approved: **Tools → Product Advertising API → Request access**
5. Generate credentials and add to the **Railway API and worker** services:

```
PAAPI_ACCESS_KEY=...
PAAPI_SECRET_KEY=...
PAAPI_PARTNER_TAG=...
```

No code changes — the adapter picks the API path automatically once these
exist.

⚠️ **Amazon requires 3 qualifying sales within 180 days** to retain PA-API
access. If it lapses, the scraping fallback is already implemented and simply
becomes primary again.

---

## Costs

| Service | Free tier | When you outgrow it |
|---|---|---|
| Supabase | 500 MB, pauses after 7 days idle | ~$25/mo |
| Upstash | 10k commands/day | ~$10/mo |
| Railway | $5 credit/mo | ~$5–10/mo per service |
| Vercel | Generous for hobby | $20/mo |

Supabase pausing on idle is the one to watch — a paused database makes the
daily sweep fail silently until someone opens the dashboard.

---

## Known gaps at deploy time

- **No Sentry.** Errors are logged as structured JSON but nothing aggregates
  them; a failing worker is invisible unless you read logs.
- **No backup policy.** Supabase's free tier keeps daily backups for 7 days.
  `price_points` is the irreplaceable table — it cannot be re-derived.
- **Docker images do not boot.** Not needed for this path; see
  `phase-14-deployment-status.md` if you want them later.
