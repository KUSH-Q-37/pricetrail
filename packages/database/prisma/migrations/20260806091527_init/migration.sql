-- ===========================================================================
-- HAND-EDITED: extensions must come first.
--
-- marketplace_listings declares `embedding vector(384)`, so the `vector` type
-- has to exist before that CREATE TABLE runs. Putting the extension in a
-- later migration would make this one fail on a clean database.
--
-- On Supabase both extensions are available but not enabled by default; these
-- statements are what enables them. `IF NOT EXISTS` keeps the migration
-- idempotent against an environment where they are already on.
-- ===========================================================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "platform" AS ENUM ('AMAZON', 'FLIPKART');

-- CreateEnum
CREATE TYPE "data_source" AS ENUM ('API', 'SCRAPE');

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('PENDING', 'READY', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "availability" AS ENUM ('IN_STOCK', 'OUT_OF_STOCK', 'LIMITED_STOCK', 'PREORDER', 'DISCONTINUED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "product_category" AS ENUM ('PHONE', 'LAPTOP', 'TABLET', 'AUDIO', 'TELEVISION', 'REFRIGERATOR', 'WASHING_MACHINE', 'AIR_CONDITIONER', 'OTHER');

-- CreateEnum
CREATE TYPE "match_status" AS ENUM ('AUTO_CONFIRMED', 'NEEDS_REVIEW', 'REJECTED', 'HUMAN_CONFIRMED', 'HUMAN_REJECTED');

-- CreateEnum
CREATE TYPE "matched_by" AS ENUM ('PIPELINE', 'HUMAN');

-- CreateEnum
CREATE TYPE "review_decision" AS ENUM ('CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "plan_tier" AS ENUM ('FREE', 'PRO', 'BUSINESS');

-- CreateEnum
CREATE TYPE "scrape_job_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "fetch_strategy" AS ENUM ('API', 'HTTP_CHEERIO', 'PLAYWRIGHT');

-- CreateEnum
CREATE TYPE "alert_status" AS ENUM ('ACTIVE', 'TRIGGERED', 'DISABLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "supabase_user_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(120),
    "role" "user_role" NOT NULL DEFAULT 'USER',
    "plan_tier" "plan_tier" NOT NULL DEFAULT 'FREE',
    "tracking_quota" INTEGER NOT NULL DEFAULT 10,
    "notify_by_email" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "category" "product_category" NOT NULL DEFAULT 'OTHER',
    "brand" VARCHAR(120),
    "display_title" VARCHAR(512) NOT NULL,
    "normalized_title" VARCHAR(512) NOT NULL,
    "model_number" VARCHAR(120),
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "image_url" VARCHAR(1024),
    "status" "product_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_listings" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "platform" "platform" NOT NULL,
    "external_id" VARCHAR(64) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "normalized_title" VARCHAR(512) NOT NULL,
    "brand" VARCHAR(120),
    "model_number" VARCHAR(120),
    "mpn" VARCHAR(120),
    "ean" VARCHAR(32),
    "upc" VARCHAR(32),
    "seller_name" VARCHAR(255),
    "rating" DECIMAL(2,1),
    "review_count" INTEGER,
    "image_url" VARCHAR(1024),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "current_price_minor" INTEGER,
    "mrp_minor" INTEGER,
    "discount_percent" INTEGER,
    "availability" "availability" NOT NULL DEFAULT 'UNKNOWN',
    "source" "data_source" NOT NULL DEFAULT 'SCRAPE',
    "tracking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_scraped_at" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "platform_data" JSONB NOT NULL DEFAULT '{}',
    "raw_attributes" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(384),
    "embedding_model" VARCHAR(64),
    "embedding_updated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
--
-- HAND-EDITED: `PARTITION BY RANGE ("captured_on")` was appended to Prisma's
-- generated DDL. Prisma cannot express partitioning, and a plain table cannot
-- be converted into a partitioned one afterwards (there is no ALTER for it) —
-- so this has to happen at creation time.
--
-- Do not regenerate this file. `prisma migrate dev` replays migration files
-- into the shadow database, so the shadow copy is partitioned too and no
-- drift is reported. Partitioning is invisible to Prisma's schema diff.
--
-- The primary key includes "captured_on" because Postgres requires the
-- partition key to be part of every unique constraint on a partitioned table.
CREATE TABLE "price_points" (
    "listing_id" UUID NOT NULL,
    "captured_on" DATE NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "price_minor" INTEGER NOT NULL,
    "mrp_minor" INTEGER,
    "discount_percent" INTEGER,
    "availability" "availability" NOT NULL DEFAULT 'UNKNOWN',
    "source" "data_source" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_points_pkey" PRIMARY KEY ("listing_id","captured_on")
) PARTITION BY RANGE ("captured_on");

-- Data-integrity guards. These cost nothing to evaluate and make a whole
-- class of scraper bug impossible to persist.
ALTER TABLE "price_points"
    ADD CONSTRAINT "price_points_price_minor_positive"
    CHECK ("price_minor" > 0);

ALTER TABLE "price_points"
    ADD CONSTRAINT "price_points_mrp_minor_positive"
    CHECK ("mrp_minor" IS NULL OR "mrp_minor" > 0);

ALTER TABLE "price_points"
    ADD CONSTRAINT "price_points_discount_percent_range"
    CHECK ("discount_percent" IS NULL OR ("discount_percent" >= 0 AND "discount_percent" <= 100));

-- CreateTable
CREATE TABLE "product_matches" (
    "id" UUID NOT NULL,
    "listing_a_id" UUID NOT NULL,
    "listing_b_id" UUID NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "identifier_score" DECIMAL(5,4) NOT NULL,
    "attribute_score" DECIMAL(5,4) NOT NULL,
    "semantic_score" DECIMAL(5,4) NOT NULL,
    "status" "match_status" NOT NULL,
    "veto_reason" VARCHAR(120),
    "matched_by" "matched_by" NOT NULL DEFAULT 'PIPELINE',
    "pipeline_version" VARCHAR(32) NOT NULL,
    "embedding_model" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_reviews" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "review_decision" NOT NULL,
    "previous_confidence" DECIMAL(5,4) NOT NULL,
    "note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_products" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "notify_below_minor" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_alerts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "threshold_minor" INTEGER NOT NULL,
    "status" "alert_status" NOT NULL DEFAULT 'ACTIVE',
    "last_triggered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_jobs" (
    "id" UUID NOT NULL,
    "listing_id" UUID,
    "platform" "platform" NOT NULL,
    "queue_job_id" VARCHAR(120),
    "status" "scrape_job_status" NOT NULL DEFAULT 'QUEUED',
    "strategy" "fetch_strategy" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "http_status" INTEGER,
    "duration_ms" INTEGER,
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(2000),
    "proxy_region" VARCHAR(32),
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrape_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_supabase_user_id_key" ON "users"("supabase_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "products_brand_model_number_idx" ON "products"("brand", "model_number");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "marketplace_listings_product_id_idx" ON "marketplace_listings"("product_id");

-- CreateIndex
CREATE INDEX "marketplace_listings_ean_idx" ON "marketplace_listings"("ean");

-- CreateIndex
CREATE INDEX "marketplace_listings_brand_model_number_idx" ON "marketplace_listings"("brand", "model_number");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_listings_platform_external_id_key" ON "marketplace_listings"("platform", "external_id");

-- CreateIndex
CREATE INDEX "product_matches_listing_a_id_idx" ON "product_matches"("listing_a_id");

-- CreateIndex
CREATE INDEX "product_matches_listing_b_id_idx" ON "product_matches"("listing_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_matches_listing_a_id_listing_b_id_key" ON "product_matches"("listing_a_id", "listing_b_id");

-- CreateIndex
CREATE INDEX "match_reviews_match_id_created_at_idx" ON "match_reviews"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "match_reviews_reviewer_id_idx" ON "match_reviews"("reviewer_id");

-- CreateIndex
CREATE INDEX "tracked_products_product_id_idx" ON "tracked_products"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_products_user_id_product_id_key" ON "tracked_products"("user_id", "product_id");

-- CreateIndex
CREATE INDEX "price_alerts_listing_id_status_idx" ON "price_alerts"("listing_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "price_alerts_user_id_listing_id_key" ON "price_alerts"("user_id", "listing_id");

-- CreateIndex
CREATE INDEX "scrape_jobs_listing_id_created_at_idx" ON "scrape_jobs"("listing_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "scrape_jobs_status_created_at_idx" ON "scrape_jobs"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "scrape_jobs_platform_created_at_idx" ON "scrape_jobs"("platform", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_listing_a_id_fkey" FOREIGN KEY ("listing_a_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_listing_b_id_fkey" FOREIGN KEY ("listing_b_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_reviews" ADD CONSTRAINT "match_reviews_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "product_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_reviews" ADD CONSTRAINT "match_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_products" ADD CONSTRAINT "tracked_products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_products" ADD CONSTRAINT "tracked_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
