-- ===========================================================================
-- Indexes Prisma cannot express
--
-- Prisma's @@index supports neither index methods with operator classes
-- (HNSW, GIN trigram) nor partial indexes (no WHERE clause). All of those
-- live here. Prisma's schema diff ignores index types it does not model, so
-- these do not register as drift.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Matching Stage A2: approximate nearest-neighbour candidate generation
-- ---------------------------------------------------------------------------
-- HNSW over cosine distance. Chosen over IVFFlat because HNSW needs no
-- training pass on existing data — IVFFlat's cluster list must be rebuilt as
-- the table grows, and our table starts empty and grows daily.
--
--   m = 16               edges per node; the pgvector default, fine to ~1M rows
--   ef_construction = 64 build-time candidate list; higher = better recall,
--                        slower build. At 10k listings the build is seconds.
--
-- Query-time recall is tuned per-session with `SET hnsw.ef_search`, not here.
CREATE INDEX "marketplace_listings_embedding_hnsw_idx"
    ON "marketplace_listings"
    USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ---------------------------------------------------------------------------
-- Matching Stage A3 + local-first search: lexical similarity
-- ---------------------------------------------------------------------------
-- Trigram GIN indexes backing `%` similarity and ILIKE. These are what make
-- the "search locally before spending a fetch" path in §3.2 viable.
CREATE INDEX "products_normalized_title_trgm_idx"
    ON "products"
    USING gin ("normalized_title" gin_trgm_ops);

CREATE INDEX "marketplace_listings_normalized_title_trgm_idx"
    ON "marketplace_listings"
    USING gin ("normalized_title" gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Partial indexes — the scheduler and worker hot paths
-- ---------------------------------------------------------------------------
-- The daily sweep asks: "which tracked listings are stalest?" Only tracked
-- rows are ever candidates, so indexing the untracked majority is wasted
-- space. NULLS FIRST puts never-scraped listings at the front of the queue.
CREATE INDEX "marketplace_listings_due_for_scrape_idx"
    ON "marketplace_listings" ("last_scraped_at" ASC NULLS FIRST)
    WHERE "tracking_enabled";

-- Backfill queue for the embedding worker (Phase 10).
CREATE INDEX "marketplace_listings_missing_embedding_idx"
    ON "marketplace_listings" ("created_at")
    WHERE "embedding" IS NULL;

-- Scraper-health view: listings currently failing. Almost always a tiny
-- fraction of the table, which is exactly when a partial index pays off.
CREATE INDEX "marketplace_listings_failing_idx"
    ON "marketplace_listings" ("consecutive_failures" DESC, "last_scraped_at" DESC)
    WHERE "consecutive_failures" > 0;

-- Admin review queue. Indexes only the 0.60-0.85 confidence band, which
-- should stay small relative to auto-confirmed and rejected rows.
CREATE INDEX "product_matches_review_queue_idx"
    ON "product_matches" ("created_at" DESC)
    WHERE "status" = 'NEEDS_REVIEW'::"match_status";

-- Retry/diagnosis path: recent failures per platform.
CREATE INDEX "scrape_jobs_failures_idx"
    ON "scrape_jobs" ("platform", "created_at" DESC)
    WHERE "status" = 'FAILED'::"scrape_job_status";

-- ---------------------------------------------------------------------------
-- NOT created, and why
-- ---------------------------------------------------------------------------
-- A BRIN index on price_points(captured_on) was in the Phase 1 plan. It is
-- redundant here: monthly partitioning already restricts any date-range scan
-- to the relevant partitions, and within a single partition every row shares
-- the same month, so BRIN's min/max block ranges carry no information.
-- Partitioning supersedes BRIN — adding both would cost writes for nothing.
