# Phase 1 — System Architecture

Status: proposed, awaiting sign-off
Project: PriceTrail — Amazon + Flipkart daily price tracking & history

---

## 1. Runtime topology

Four independently deployable processes. One database, one Redis.

```
                        ┌──────────────────────────────┐
                        │        Browser (user)        │
                        └──────────────┬───────────────┘
                                       │ HTTPS
                        ┌──────────────▼───────────────┐
                        │   apps/web — Next.js         │   Vercel
                        │   RSC + client dashboard     │   (serverless/edge)
                        └──────────────┬───────────────┘
                                       │ REST + JWT
                        ┌──────────────▼───────────────┐
                        │   apps/api — NestJS          │   Container
                        │   authz · validation · CRUD  │   1..N replicas
                        │   enqueue only, never scrape │   stateless
                        └───┬───────────────┬──────────┘
                            │               │
                 ┌──────────▼─────┐   ┌─────▼──────────────┐
                 │  PostgreSQL    │   │  Redis             │
                 │  Supabase      │   │  BullMQ queues     │
                 │  + pgvector    │   │  + throttler store │
                 └──────────▲─────┘   └─────┬──────────────┘
                            │               │ BRPOP
                            │        ┌──────▼───────────────┐
                            │        │ apps/worker          │  Container
                            └────────┤ BullMQ workers       │  1..N replicas
                                     │ Playwright + Cheerio │  512MB–1GB each
                                     │ embeddings (ONNX)    │  NOT serverless
                                     └──────┬───────────────┘
                                            │ HTTPS via proxy pool
                                     ┌──────▼───────────────┐
                                     │ amazon.in / flipkart │
                                     └──────────────────────┘

                 ┌──────────────────────────────────────────┐
                 │ apps/scheduler — BullMQ repeatable jobs   │  1 replica
                 │ fans out daily tracking work into queues  │  tiny
                 └──────────────────────────────────────────┘
```

### Why these process boundaries

| Boundary | Reason |
|---|---|
| Web ≠ API | Next.js on Vercel has a hard function timeout and no persistent connections. The API owns the DB connection pool and all authorization. The browser never touches Postgres. |
| API ≠ Worker | A Chromium context costs 300–500 MB and a scrape takes 5–40 s. Co-locating that with request handling means one slow scrape degrades every API request, and you'd be forced to scale API replicas by scraper memory instead of by traffic. Separate processes = separate scaling axes. |
| Worker is a container, never serverless | Playwright needs system libraries, a writable filesystem, browser warm-up amortization, and runtimes past serverless limits. |
| Scheduler is its own single-replica process | See §1.1. |

### 1.1 Correction to the requested stack: scheduling

You listed **node-cron + BullMQ + Redis**. Running `node-cron` inside the API or worker is a bug the moment you scale past one replica — every replica fires the same cron tick, and you get N duplicate daily runs.

Use **BullMQ repeatable jobs** (`repeat: { pattern: '0 2 * * *' }`) instead. BullMQ deduplicates repeatable jobs in Redis, so the schedule fires exactly once regardless of replica count. `node-cron` stays in the stack only for in-process housekeeping that is safe to run per-replica (metrics flush, cache sweep) and for local dev convenience.

### 1.2 Trust boundary

**The NestJS API is the only trust boundary.** Prisma connects to Postgres as a privileged role, so Row Level Security cannot be the primary authorization mechanism — Prisma bypasses it. RLS is enabled anyway as defense-in-depth (in case Supabase's REST endpoint is ever exposed), but every ownership check lives in a NestJS guard or in the repository layer's `where` clause.

```
Browser ──JWT──▶ [ NestJS Guard: verify JWT via Supabase JWKS ]
                 [ Guard: role/ownership check              ]
                 [ ZodValidationPipe: parse & narrow input  ]
                 [ Service: business logic                  ]
                 [ Repository: Prisma, always scoped by userId ]
                                    │
                                 Postgres
```

---

## 2. Technology decisions

### Frontend

| Tech | Role | Why this and not the alternative |
|---|---|---|
| **Next.js (App Router)** | Shell, routing, SSR of public pages | Product pages benefit from SSR for SEO and fast first paint; the dashboard is client-heavy. App Router lets both live in one app. Pin the exact version at install; do not float. |
| **TypeScript** | Everything | Non-negotiable: scraped data is untyped garbage until validated, and Zod + TS gives one source of truth for the shape. |
| **Tailwind + shadcn/ui** | Styling, primitives | shadcn copies source into your repo instead of shipping a dependency — you own the components, so the chart/table skinning has no upstream fight. |
| **TanStack Query** | Server state | Price data is *server* state: cached, refetched, invalidated, paginated. Caching it in Zustand would mean hand-rolling staleness and dedupe. |
| **Zustand** | Client state only | Selected chart range, platform toggles, comparison drawer, filters. Small, no boilerplate. **Rule: nothing fetched from the API is ever stored in Zustand.** |
| **Apache ECharts + echarts-for-react** | Charts | The only mainstream JS chart lib where zoom/pan (`dataZoom`), large-series downsampling, and dual-axis comparison are first-class rather than plugins. Recharts would choke at 550+ points × 2 series with pan. |
| **Framer Motion** | Animation | Layout transitions and chart-panel enter/exit. Kept out of the chart canvas — ECharts owns its own animation. |

### Backend

| Tech | Role | Why |
|---|---|---|
| **NestJS** | API framework | DI container, module boundaries, guards/interceptors/pipes as first-class. The matching engine has 4 pluggable layers — DI is how you swap and test them in isolation. Express alone would mean hand-rolling all of it. |
| **Zod** | Validation | Two jobs: (a) validating HTTP input, (b) **validating scraped output**. Job (b) is the important one — a scraper returning `price: "₹1,29,999"` or `null` must fail loudly at the boundary, not write `NaN` into price history. |
| **Prisma** | ORM / migrations | Typed queries, good migration story. Known limits: no native support for `vector` columns or table partitioning → those are handwritten SQL migrations (§4.6). Accepted trade-off. |
| **Pino** | Logging | Structured JSON, ~5× faster than Winston, integrates with Nest via `nestjs-pino`, carries a correlation ID through API → queue → worker. |
| **BullMQ + Redis** | Queues | Retries with backoff, rate limiting per queue, repeatable jobs, dead-letter via failed set, priorities. |
| **Playwright + Cheerio** | Scraping | Playwright when JS rendering / anti-bot evasion is required; Cheerio to parse HTML when a plain `fetch` sufficed. **Always try the cheap path first** — Cheerio-on-fetch is ~50× cheaper than a browser context. |

### Data & AI

| Tech | Decision |
|---|---|
| **Supabase Postgres** | Managed Postgres with `pgvector` and `pg_trgm` available, plus Auth we're already using. One vendor, one connection string. Use the **transaction pooler (port 6543)** for the API, and a **direct connection (5432)** for Prisma Migrate. |
| **pgvector** | HNSW index for approximate nearest neighbour over product embeddings. Candidate generation only — never the final decision (§3.3). |
| **Embedding model: `bge-small-en-v1.5` (384-dim)** | Runs on CPU in-process via `@huggingface/transformers` (ONNX). 384 dims = half the storage and a materially smaller HNSW index vs. 768-dim `bge-base`. Product titles are short; the accuracy delta doesn't justify 2× the index. **Escape hatch:** the `EmbeddingProvider` interface has one method, so switching to a hosted API (Voyage/Jina) or a Python sidecar is a one-file change. |

### Infrastructure

| Concern | Choice |
|---|---|
| Web hosting | Vercel |
| API + Worker + Scheduler | Railway or Fly.io (containers, persistent, cheap). **Not** Vercel — Playwright will not run there. |
| Postgres | Supabase |
| Redis | Railway/Upstash. If Upstash: use a **paid plan with no request cap** — BullMQ is chatty and free-tier command limits will silently stall queues. |
| Proxies | Residential rotating pool (BrightData / Oxylabs / Smartproxy). Budget line item, not optional, for daily Amazon at any volume. |
| Errors | Sentry across all three Node processes |
| Queue ops | `bull-board`, mounted behind admin auth |

### Local dev note (your machine)

Docker isn't installed. Two options:
1. **Install Docker Desktop** → `docker-compose.yml` gives you local Postgres+pgvector and Redis. Preferred; keeps dev isolated.
2. **No Docker** → use a free Supabase project as your dev DB and a free Railway Redis. Works, but you share a remote DB and migrations are riskier.

I recommend option 1.

---

## 3. Data flow

### 3.1 Ingest by URL

```
User pastes https://www.amazon.in/dp/B0XXXX
    │
    ▼
POST /api/v1/products/ingest { url }
    │
    ├─ Zod: parse URL → { platform: AMAZON, externalId: "B0XXXX" }
    ├─ Lookup marketplace_listings WHERE platform+externalId
    │      └─ HIT  → return existing product + listing         (0 scrapes)
    │      └─ MISS → create Product(status=PENDING)
    │                enqueue scrape:listing { platform, externalId, priority: HIGH }
    │                return 202 { productId, status: PENDING }
    ▼
Frontend polls GET /api/v1/products/:id  (TanStack Query, refetchInterval)
    │
    ▼ (worker, ~10s later)
Worker: fetch → parse → Zod-validate → upsert listing → insert price_point
    │
    ▼
Worker: enqueue embed:listing → embedding written to listings.embedding
    │
    ▼
Worker: enqueue match:find { listingId, targetPlatform: FLIPKART }
    │
    ▼
Matching pipeline (§3.3) → product_match row (confidence + decision)
    │
    ▼
Product.status = READY   →   frontend poll returns full payload
```

### 3.2 Ingest by name

```
GET /api/v1/search?q=iphone 15 pro 256gb
    │
    ├─ 1. Local first: pg_trgm similarity over products.normalized_title
    │        └─ good local hits → return immediately (0 scrapes)
    │
    └─ 2. Cold miss → enqueue search:platform for BOTH platforms
              worker runs a platform search page, takes top ~10 results
              creates Product(status=PENDING) rows
              → then identical to §3.1 from the parse step onward
```

Local-first is what keeps the scrape budget survivable.

### 3.3 Matching pipeline (the core module)

Two distinct stages that are easy to conflate. **Candidate generation** is recall-oriented and cheap; **scoring** is precision-oriented and expensive. You cannot score every pair — with 100k listings that's 10^10 comparisons.

```
INPUT: source listing (Amazon)      TARGET: Flipkart

┌─ STAGE A — CANDIDATE GENERATION (recall; want ~20–50 candidates) ─┐
│  A1  Identifier index   : model_number / MPN / EAN / GTIN exact   │
│  A2  Vector ANN         : pgvector HNSW, top-50 by cosine         │
│  A3  Lexical            : pg_trgm on normalized_title, top-50     │
│      union, dedupe                                                │
└───────────────────────────────────────────────────────────────────┘
                              │  ~50 candidates
                              ▼
┌─ STAGE B — SCORING (precision; per candidate) ────────────────────┐
│  L1  Identifier match     weight 0.40                              │
│         model/MPN/EAN equal after normalization                    │
│  L2  Attribute match      weight 0.30                              │
│         brand, RAM, storage, colour, size, variant                 │
│  L3  Semantic similarity  weight 0.30                              │
│         cosine(source.embedding, candidate.embedding)              │
│                                                                    │
│  score = 0.40·L1 + 0.30·L2 + 0.30·L3                               │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STAGE C — HARD VETOES (applied AFTER scoring, override score) ───┐
│  brand mismatch          → REJECT regardless of score              │
│  storage/RAM mismatch    → REJECT (128GB ≠ 256GB)                  │
│  accessory vs. device    → REJECT (case/cover/screen guard)        │
│  renewed vs. new         → REJECT                                  │
│  price ratio > 3×        → force REVIEW                            │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        score ≥ 0.85  → AUTO_CONFIRMED  → tracking enabled
        0.60 – 0.85   → NEEDS_REVIEW    → review queue, NOT tracked
        < 0.60        → REJECTED
```

**Why vetoes are separate from weights:** a 256 GB and a 128 GB iPhone 15 Pro share brand, model, embedding space, and 95% of their title. Pure weighted scoring rates them ~0.93 and confidently pairs the wrong products forever. A veto rule is the only thing that catches this. This is the single biggest correctness risk in the project.

**Never auto-track a `NEEDS_REVIEW` match.** A wrong match silently corrupts price history, and it is not recoverable after the fact.

### 3.4 Daily tracking

```
02:00 IST — BullMQ repeatable job fires (exactly once, cluster-wide)
    │
    ▼
Scheduler: SELECT listings WHERE tracking_enabled AND NOT scraped today
    │        chunk into batches of 100
    ▼
Enqueue N jobs into queue:scrape with JITTERED delay spread over 6 hours
    │   ← critical: 50k simultaneous requests at 02:00 = instant ban
    ▼
Worker pool (concurrency 5–10/replica, BullMQ limiter: 30 jobs/min/platform)
    │
    ├─ Try Cheerio-on-fetch  ──success──▶ parse
    │        └─ blocked/JS-gated → escalate to Playwright + proxy
    │
    ▼
Zod validate → if invalid: fail job, alert, WRITE NOTHING
    │
    ▼
Transaction:
   UPDATE marketplace_listings (title, availability, rating, seller, scraped_at)
   INSERT INTO price_points (listing_id, price, mrp, discount_pct, captured_at)
      ← append-only; skipped if price identical to last point AND <24h elapsed
    │
    ▼
Rollup job (04:00): refresh daily_price_summary for changed listings
    │
    ▼
Alerts job: price-drop notifications for watching users

FAILURE PATH
  attempt 1 fail → backoff 1 min   → retry
  attempt 2 fail → backoff 5 min   → retry (force Playwright + fresh proxy)
  attempt 3 fail → backoff 30 min  → retry
  final fail     → scrape_jobs.status = FAILED, consecutive_failures++
                   consecutive_failures ≥ 5 → tracking auto-paused + alert
```

**Gaps in the chart are correct.** If a scrape fails, no point is written. Never interpolate a price you didn't observe — the chart must show what was measured, and the UI renders gaps explicitly.

### 3.5 Chart read path

```
GET /api/v1/products/:id/history?range=1Y&platforms=amazon,flipkart
    │
    ├─ range ≤ 3M  → query price_points directly (raw daily points)
    ├─ range > 3M  → query daily_price_summary (pre-aggregated)
    │
    ├─ if points > 400 → LTTB downsample server-side to ~300
    │      ← preserves visual peaks/troughs, unlike naive nth-point sampling
    │
    ├─ Cache-Control: public, max-age=3600  (data changes once/day)
    ▼
{ series: [ { platform, currency, points: [[ts, price], ...] } ],
  meta: { downsampled: true, gaps: [[from,to]], min, max, avg } }
```

---

## 4. Database overview

### 4.1 Entities

```
users ──┬──< tracked_products >──┬── products ──< marketplace_listings ──< price_points
        │                        │        │              │                    │
        └──< price_alerts        │        │              ├──< scrape_jobs     └── (partitioned)
                                 │        │              └── embedding vector(384)
                                 │        │
                                 │        └──< product_matches (listing_a ↔ listing_b)
                                 │
                                 └── daily_price_summary (rollup)
```

### 4.2 The one schema decision worth arguing about

You asked for `amazon_products` and `flipkart_products` as separate tables. **I recommend against it**, and here's the concrete reason:

Every query you care about is platform-agnostic — "give me price history for both platforms", "find matches across platforms", "list all listings due for scraping". With split tables, each of those becomes a UNION, the matching engine needs two code paths, and adding Croma or Reliance Digital later means a third table plus rewriting every query.

**Instead:**

- `marketplace_listings` — one row per platform listing, discriminated by `platform` enum. All shared fields are real typed columns.
- `platform_data JSONB` — genuinely platform-specific extras (ASIN sales rank, Flipkart Plus flag, F-Assured). Validated by a per-platform Zod schema on write, so it's typed at the boundary even though Postgres sees JSONB.

This costs nothing and makes platform #3 a config change instead of a migration.

### 4.3 Core tables

**`users`** — mirrors Supabase `auth.users` via `supabase_user_id UUID UNIQUE`. Local table holds app concerns: plan tier, tracking quota, notification prefs. Supabase Auth owns credentials; we never store passwords.

**`products`** — the *canonical, platform-independent* concept ("iPhone 15 Pro 256 GB Natural Titanium"). Holds `brand`, `normalized_title`, `category`, and the extracted `attributes JSONB` used by matching Layer 2. One product ↔ many listings.

**`marketplace_listings`** — one row per platform. Key columns: `platform`, `external_id` (ASIN / FSN), `url`, `title`, `seller`, `rating`, `review_count`, `availability`, `current_price`, `mrp`, `tracking_enabled`, `last_scraped_at`, `consecutive_failures`, `embedding vector(384)`, `platform_data JSONB`.
Unique on `(platform, external_id)` — this is the idempotency key that makes re-ingesting the same URL free.

**`price_points`** — append-only time series. `(listing_id, captured_at, price, mrp, discount_pct, availability, currency)`. **Never updated, never deleted.** This table is the product.

**`daily_price_summary`** — rollup: `(listing_id, day, open, close, min, max, avg, sample_count)`. Serves 6M / 1Y / 1.5Y chart ranges without touching the raw table.

**`product_matches`** — `(listing_a_id, listing_b_id, confidence, layer1_score, layer2_score, layer3_score, status, matched_by, reviewed_by, reviewed_at, veto_reason)`. Storing per-layer sub-scores is deliberate: when a match is wrong you need to see *which layer* was fooled, or you can't tune the weights. Unique on the ordered pair.

**`scrape_jobs`** — audit trail per attempt: `(listing_id, queue_job_id, status, attempt, strategy, http_status, duration_ms, error_code, error_message, proxy_region, started_at, finished_at)`. This is your scraper-health dashboard and the only way to diagnose "Amazon started blocking us on Tuesday".

**`tracked_products`** — join of user → product, with `notify_below` threshold and `created_at`. Enforces per-plan quota.

### 4.4 Volume and partitioning

| Tracked listings | Rows @ 1.5 yr daily | Approx size |
|---|---|---|
| 1 000 | 550 k | ~50 MB |
| 10 000 | 5.5 M | ~500 MB |
| 100 000 | 55 M | ~5 GB + indexes |

`price_points` is **range-partitioned by month** on `captured_at`. Benefits: index scans stay small, old partitions can be detached/archived cheaply, and the 7-day chart query touches exactly one partition.

Prisma cannot express partitioning → the partition DDL and a monthly `create_next_partition()` maintenance job live in a handwritten SQL migration. Prisma still reads/writes the parent table normally.

### 4.5 Index plan

| Table | Index | Serves |
|---|---|---|
| `marketplace_listings` | UNIQUE `(platform, external_id)` | ingest idempotency |
| `marketplace_listings` | `(tracking_enabled, last_scraped_at)` WHERE tracking_enabled | scheduler's daily sweep |
| `marketplace_listings` | HNSW `(embedding vector_cosine_ops)` | Stage A2 candidate ANN |
| `products` | GIN `(normalized_title gin_trgm_ops)` | Stage A3 + local search |
| `products` | `(brand, model_number)` | Stage A1 identifier match |
| `price_points` | `(listing_id, captured_at DESC)` per partition | every chart query |
| `price_points` | BRIN `(captured_at)` | rollup range scans, ~1000× smaller than btree |
| `product_matches` | UNIQUE `(listing_a_id, listing_b_id)` | dedupe |
| `product_matches` | `(status)` WHERE status='NEEDS_REVIEW' | review queue |
| `scrape_jobs` | `(listing_id, created_at DESC)` | failure diagnosis |

### 4.6 Handwritten SQL migrations (outside Prisma)

1. `CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;`
2. `embedding vector(384)` column + HNSW index
3. `price_points` partitioning DDL + monthly partition function
4. BRIN and partial indexes
5. RLS policies (defense-in-depth)

---

## 5. Folder structure

pnpm workspaces + Turborepo monorepo. One repo, four deployables, shared types.

```
pricetrail/
├── apps/
│   ├── web/                          # Next.js
│   │   ├── src/app/
│   │   │   ├── (marketing)/          # public, SSR, SEO
│   │   │   ├── (auth)/               # login, signup, callback
│   │   │   ├── (dashboard)/
│   │   │   │   ├── layout.tsx        # auth-guarded shell
│   │   │   │   ├── page.tsx          # tracked products grid
│   │   │   │   ├── products/[id]/    # detail + charts
│   │   │   │   ├── compare/
│   │   │   │   └── settings/
│   │   │   └── api/                  # BFF only: auth cookie exchange
│   │   ├── src/components/
│   │   │   ├── ui/                   # shadcn — generated, don't hand-edit
│   │   │   ├── charts/               # PriceChart, ComparisonChart, RangeSelector
│   │   │   ├── products/
│   │   │   └── layout/
│   │   ├── src/hooks/                # useProduct, usePriceHistory (TanStack)
│   │   ├── src/lib/
│   │   │   ├── api-client.ts         # typed fetch wrapper, injects JWT
│   │   │   └── query-client.ts
│   │   └── src/stores/               # Zustand — UI state ONLY
│   │
│   ├── api/                          # NestJS
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/
│   │   │   │   ├── guards/           # JwtAuthGuard, RolesGuard, QuotaGuard
│   │   │   │   ├── interceptors/     # logging, correlation-id, transform
│   │   │   │   ├── filters/          # global exception → RFC7807 problem+json
│   │   │   │   ├── pipes/            # ZodValidationPipe
│   │   │   │   └── decorators/       # @CurrentUser()
│   │   │   ├── config/               # Zod-validated env, fails fast on boot
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── products/
│   │   │   │   ├── listings/
│   │   │   │   ├── tracking/
│   │   │   │   ├── prices/           # history + downsampling
│   │   │   │   ├── matching/         # ← core; see packages/matching
│   │   │   │   ├── search/
│   │   │   │   ├── admin/            # review queue, scraper health
│   │   │   │   └── queue/            # producers only, never consumers
│   │   │   └── infra/
│   │   │       ├── prisma/
│   │   │       ├── redis/
│   │   │       └── logger/
│   │   └── test/
│   │
│   ├── worker/                       # BullMQ consumers
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── processors/
│   │   │   │   ├── scrape-listing.processor.ts
│   │   │   │   ├── search-platform.processor.ts
│   │   │   │   ├── embed-listing.processor.ts
│   │   │   │   ├── match-listing.processor.ts
│   │   │   │   └── rollup-daily.processor.ts
│   │   │   ├── browser/
│   │   │   │   ├── browser-pool.ts   # reuse contexts; launching is expensive
│   │   │   │   ├── stealth.ts        # UA, viewport, locale, timezone
│   │   │   │   └── proxy-manager.ts  # rotation + health scoring
│   │   │   └── health.ts             # HTTP /health for the platform
│   │   └── Dockerfile                # playwright base image
│   │
│   └── scheduler/                    # registers BullMQ repeatable jobs
│       └── src/jobs/
│
├── packages/
│   ├── database/                     # Prisma is owned HERE, not by apps
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/           # incl. handwritten SQL (§4.6)
│   │   │   └── seed.ts
│   │   └── src/index.ts              # exports client + generated types
│   │
│   ├── marketplace/                  # API-primary, scrape-fallback
│   │   ├── src/
│   │   │   ├── adapter.interface.ts  # MarketplaceAdapter contract
│   │   │   ├── amazon/
│   │   │   │   ├── amazon.api.ts     # PA-API 5.0  ← PRIMARY
│   │   │   │   ├── amazon.scraper.ts # Playwright  ← FALLBACK
│   │   │   │   ├── amazon.parser.ts  # Cheerio, isolated
│   │   │   │   └── selectors.ts      # ← breaks most often; one file
│   │   │   ├── flipkart/             # mirrors amazon/
│   │   │   └── shared/               # price/attribute normalizers
│   │   └── test/fixtures/            # saved HTML + recorded API responses
│   │
│   ├── matching/                     # pure functions, zero I/O
│   │   ├── src/
│   │   │   ├── pipeline.ts
│   │   │   ├── layers/
│   │   │   │   ├── identifier.layer.ts
│   │   │   │   ├── attribute.layer.ts
│   │   │   │   └── semantic.layer.ts
│   │   │   ├── schemas/              # per-category attribute + veto definitions
│   │   │   ├── vetoes.ts             # §3.3 stage C
│   │   │   ├── normalizers/          # brand/colour/storage/RAM canonicalization
│   │   │   └── scoring.ts
│   │   └── test/cases/               # golden set of known match/non-match pairs
│   │
│   ├── embeddings/
│   │   └── src/
│   │       ├── provider.interface.ts # one method: embed(texts) => vectors
│   │       ├── local-onnx.provider.ts
│   │       └── text-builder.ts       # what text actually gets embedded
│   │
│   ├── shared/                       # Zod schemas + inferred types
│   │   └── src/
│   │       ├── schemas/              # single source of truth, API + worker
│   │       ├── constants/
│   │       └── errors/
│   │
│   ├── queue/                        # queue names, job payload types, opts
│   ├── logger/
│   └── config/                       # eslint, tsconfig, tailwind presets
│
├── docs/
├── docker-compose.yml                # postgres+pgvector, redis
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example
```

### Notes on the layout

- **`packages/matching` has no I/O.** It takes two listing objects and returns a score. That makes the hardest module in the project unit-testable against a golden fixture set, with no DB and no network.
- **`packages/scrapers/*/selectors.ts`** isolates the code most likely to break. When Amazon changes its DOM, you edit one file.
- **`test/fixtures/` holds saved HTML.** Parser tests run offline, in CI, deterministically.
- **`packages/shared/schemas`** is the contract. The worker validates scraped data against the same schema the API validates responses with.
- **The API never consumes queues; the worker never serves HTTP** (beyond `/health`).

---

## 6. Roadmap

Your 14 phases, with concrete exit criteria.

| # | Phase | Deliverable | Done when |
|---|---|---|---|
| 1 | Architecture | This document | You sign off |
| 2 | Database | Prisma schema + SQL migrations, seed | `migrate dev` clean; pgvector + partitions live |
| 3 | API foundation | Nest bootstrap, config, logging, errors, health, Swagger | `/health` green, env fails fast, error envelope consistent |
| 4 | Frontend foundation | Next + Tailwind + shadcn + providers, layout, empty states | Dashboard shell renders, dark mode, mobile |
| 5 | Auth | Supabase Auth, JwtAuthGuard, protected routes, quotas | Signup→login→protected fetch works end to end |
| 6 | Products | Ingest-by-URL, CRUD, tracking toggle, quota enforcement | Paste URL → product row → visible in UI |
| 7 | Amazon scraper | Adapter, parser, fixtures, Zod validation, browser pool | 20 real ASINs parse correctly; malformed input rejected |
| 8 | Flipkart scraper | Same shape as 7 | Same bar |
| 9 | Matching L1+L2 | Identifier + attribute layers, normalizers, vetoes | Golden set: ≥95% precision on known pairs |
| 10 | Embeddings + pgvector | ONNX provider, backfill, HNSW, Stage A2 | ANN returns true match in top-10 ≥90% of the time |
| 11 | Workers | BullMQ queues, processors, scheduler, retries, bull-board | Daily run completes; killed worker resumes; failures visible |
| 12 | Charts | ECharts area/comparison, ranges, downsampling, gaps | All 6 ranges render <300 ms; zoom/pan; gaps honest |
| 13 | Testing | Unit (matching/parsers), integration (API+DB), e2e (Playwright) | CI green; matching + parsers >80% coverage |
| 14 | Deploy | Dockerfiles, CI/CD, envs, Sentry, backups, runbook | Prod live; daily job runs unattended for 7 days |

**Suggested reordering:** phases 7–8 are the highest-risk work (anti-bot defeats schedules, not architecture). Consider a timeboxed spike on Amazon parsing right after Phase 2 to de-risk early. Happy to keep the stated order if you prefer.

---

## 7. Decisions (locked 2026-08-06)

| # | Decision | Choice |
|---|---|---|
| 1 | Launch scale | **1k–10k tracked listings** |
| 2 | Data source | **Official APIs primary on both platforms**, scraping as fallback |
| 3 | Catalogue scope | **Electronics + appliances** |
| 4 | Auth | **Supabase Auth** (default, unchallenged) |
| 5 | 0.60–0.85 band | **Admin review UI** |

### 7.1 Consequences for Phase 2

**Scale (1k–10k)**
- Monthly partitioning on `price_points` ships day one — cheap now, a full-table migration later. At 10k listings × 1.5 yr that's ~5.5 M rows / ~500 MB.
- No read replicas, no rollup tuning beyond the nightly `daily_price_summary` job. Single Postgres instance is comfortably sufficient.

**Official APIs primary — the biggest change**

`packages/scrapers` is renamed **`packages/marketplace`**. Scraping is no longer the headline; it's one of two strategies behind `MarketplaceAdapter`:

```
MarketplaceAdapter
   ├─ ApiStrategy       ← primary   (PA-API 5.0 / Flipkart Affiliate)
   └─ ScrapeStrategy    ← fallback  (Playwright + Cheerio)
        used when: API lacks the field, quota exhausted, or API errors
```

Schema effects:
- `price_points.source` and `marketplace_listings.source` enums (`API` / `SCRAPE`) — provenance matters. API prices are authoritative; scraped ones carry lower trust and should be visually distinguishable in admin views.
- Identifier columns get first-class treatment rather than best-effort regex extraction: PA-API returns `EAN`/`UPC`/`PartNumber`/`Brand`/`Model` as structured fields. **This makes matching Layer 1 dramatically more reliable** — the identifier layer stops guessing.
- Store affiliate tag / tracking ID per platform in config (monetization path, and PA-API requires it on every call).

Throughput math, which is *better* than the scraping path: PA-API `GetItems` batches **10 ASINs per request**. 10 000 listings → 1 000 requests. At the initial 1 TPS floor that's ~17 minutes for the whole daily sweep, versus ~6 hours of jittered scraping. The scheduler's fan-out logic in §3.4 changes accordingly — batch by 10, not by 100.

**Two access risks to verify before Phase 7, not after:**
1. PA-API requires an approved Associates account **and** qualifying sales to retain access (Amazon revokes credentials from accounts that don't convert). Confirm you can hold the credentials.
2. Flipkart's affiliate programme has had extended periods of restricted onboarding. Confirm you can actually obtain a token.

If either falls through, the `ScrapeStrategy` fallback is already the full implementation — nothing is wasted, we just promote it back to primary for that platform. This is exactly why the strategy sits behind an interface.

**Electronics + appliances**

Layer 2 becomes **category-dispatched** rather than one flat attribute comparator:

```
category_attribute_schemas   (seeded, not user-editable in v1)
  ├─ PHONE      : brand, model, ram_gb, storage_gb, colour, network
  ├─ LAPTOP     : brand, model, ram_gb, storage_gb, cpu, screen_in, gpu
  ├─ TABLET     : brand, model, ram_gb, storage_gb, colour, connectivity
  ├─ AUDIO      : brand, model, form_factor, colour, anc
  ├─ TV         : brand, model, screen_in, panel, resolution
  ├─ REFRIGERATOR / WASHER / AC :
                  brand, model, capacity_l_or_kg_or_ton, star_rating, type
```

Each schema declares which attributes are **veto-eligible** (mismatch ⇒ REJECT) versus merely score-contributing. `storage_gb` is veto-eligible on a phone; `colour` is not. `capacity` and `star_rating` are veto-eligible on appliances. This lives in `packages/matching/src/schemas/` as typed data, so Phase 9 tests it without a DB.

**Admin review UI**

Adds to Phase 2:
- `users.role` enum (`USER` / `ADMIN`)
- `match_reviews` — `(match_id, reviewer_id, decision, previous_confidence, note, created_at)`. An audit row per human decision, kept separately from `product_matches` so the decision history survives re-matching.
- Confirmed/rejected reviews become the **golden test set** for Phase 9 — this is the feedback loop that lets you tune the 0.40/0.30/0.30 weights against real data instead of intuition.

Adds to Phase 6/9: an `/admin/matches` route (guarded by `RolesGuard`) with a side-by-side listing comparison and per-layer score breakdown.

---

## 8. Amendments made during Phase 2

Four things above turned out to be wrong or redundant once the schema was
actually built and measured. Recorded here rather than edited in place, so the
reasoning survives.

**8.1 `daily_price_summary` removed.**
The rollup was justified by "pre-aggregate long chart ranges". At a once-daily
capture cadence it has *the same row count as* `price_points` — the dedup rule
already yields at most one point per listing per day. It would have been a
duplicate of the source table with no read advantage. Charts read
`price_points` directly; 1.5 years is 550 rows per series, served from the
primary key. It comes back only if we move to intra-day sampling, where a day
holds multiple observations and a daily close/min/max genuinely compresses.

**8.2 BRIN index on `captured_on` removed.**
Superseded by partitioning. A date-range scan is already restricted to the
relevant monthly partitions, and *within* a partition every row shares the same
month — so BRIN's min/max block ranges carry no information. Keeping both would
cost write throughput for zero read benefit. Verified: the 7-day chart query
plans as `Append` with `Subplans Removed: 17`.

**8.3 Category attribute schemas live in code, not the database.**
§7.1 sketched a `category_attribute_schemas` table. They are instead typed data
in `packages/matching/src/schemas/`, because they are versioned with the
matching logic they drive and must be unit-testable without a database. The
database stores only extracted attribute *values*, in `products.attributes`.

**8.4 `price_points` identity is `(listing_id, captured_on)`, not a surrogate id.**
`captured_on` is a plain `date` column — not generated, since Postgres forbids
generated columns in a partition key — that the application sets. One choice
does four jobs: it is the natural identity of an observation, it makes a
duplicate-day write impossible under a retry storm, it satisfies Postgres's
rule that the partition key appear in every unique constraint, and its btree
order is exactly what chart queries scan.

**8.5 No DEFAULT partition, deliberately.**
A default partition looks like a safety net but is a trap: rows for an
uncovered month land in it silently, and Postgres then refuses to create the
real partition for that month. Instead 31 partitions are pre-created (18 back,
12 forward) and a monthly maintenance job extends the window. A missing
partition raises `no partition of relation found for row` — loud, immediate,
and fixable.

**8.6 Operational note — always send a bounded date range.**
`WHERE captured_on >= $from` prunes only the past. `WHERE captured_on BETWEEN
$from AND $to` prunes both ends. The Phase 3 history endpoint must send both
bounds, even when `$to` is today.

---

## 9. Amendment made during deployment — the worker is a function, not only a process

**Status: supersedes the strict process separation implied by §2.**

Phase 1 specified the API and the worker as separate deployables, for reasons
that remain correct: scraping is slow and memory-hungry, its failure modes are
unrelated to request handling, and the two scale on different axes. That is
still the production target and `apps/worker` is still its own deployable.

What Phase 1 did not account for is a deployment where **only one service can
exist**. On a free hosting tier the API deploys and the worker does not, and
the result is not degraded — it is silently broken. The API accepts products
and enqueues scrape jobs that nothing consumes, so every product stays at
`PENDING` forever while the UI shows "Fetching details". Nothing in the logs
reports an error, because no component failed; the consumer was simply absent.
The only remedy available to the operator was to run the worker by hand on a
laptop, which is not an operational model.

**The change.** The runtime moved out of `apps/worker/src/main.ts` into
`apps/worker/src/runtime.ts`, exported as `startWorkerRuntime()`. It has two
callers:

- `apps/worker/src/main.ts` — the standalone process. Now only a signal
  handler around the runtime.
- `apps/api/src/main.ts` — starts the same code when `RUN_WORKERS_IN_API=true`.

Both run *identical* consumer code. The env var selects topology, not
behaviour, so moving to a dedicated worker later is a configuration change
with no code path that was never exercised.

### 9.1 What co-hosting costs

Real, and the reason it is off by default:

- **One event loop.** A scrape competes with request handling. Concurrency is
  capped at 1 when embedded (`API_SCRAPE_CONCURRENCY`, max 4).
- **Shared memory.** The ONNX embedding model (~130 MB) is charged to the API.
  On a 512 MB instance a Playwright fallback context (300-500 MB) would evict
  it, which is exactly why concurrency must stay at 1.
- **Shared blast radius.** An OOM in a scrape takes request serving with it.

### 9.2 Constraints the implementation must honour

- **Start after `listen()`.** A slow Redis handshake or model load must never
  delay the port opening, or the platform's health check fails the deploy
  before the queue has finished warming up.
- **Never fatal.** Runtime startup is wrapped: if Redis is unreachable the API
  logs and continues. Reading existing price history stays available; only new
  fetches stall. A queue that will not start must not cause a total outage.
- **Borrow, do not open.** The runtime accepts the caller's `PrismaClient` and
  disconnects it on shutdown *only if it created it*. A free Postgres tier
  counts connections, and disconnecting a borrowed client would take the API's
  database access down with it.

### 9.3 Build-order consequence

`apps/api` now imports `@pricetrail/worker`, so `build:apps` builds the worker
first. Reversed, `tsc` cannot resolve the types and the API build fails.

### 9.4 Remaining gap

Free instances sleep after ~15 minutes idle, and a sleeping process runs no
cron. The 02:00 daily sweep is registered in Redis and fires when the service
is awake, so on a free tier it needs an external pinger to guarantee it. A
paid always-on worker removes this entirely and is the correct end state.
