-- Reset price history to the launch date: 20 August 2026.
--
-- Everything recorded before this is development data. It was collected while
-- the ingest path, the business-date handling and the price-point upsert were
-- all still being corrected, so it is sparse, patchy, and in places wrong --
-- prices captured under the old getUTCDate() logic landed on the wrong
-- business day, and the pre-upsert sweep kept the FIRST observation of a day
-- rather than the last. Showing it to anyone would misrepresent what the
-- product actually does.
--
-- WHAT THIS DELETES: price observations only.
--
-- Products and listings are untouched, and every listing stays tracked. The
-- catalogue survives; only its history restarts. A product tracked since 8
-- August remains tracked, and simply begins its chart on 20 August.
--
-- This is deliberately a migration rather than a script. There is no way to
-- run a one-off command against the production database from the deploy
-- pipeline, and a migration runs exactly once by construction -- which is the
-- correct number of times for a launch reset.
--
-- Re-running on a fresh database is a no-op: there is nothing before the
-- cutoff to delete.

DELETE FROM "price_points"
WHERE "captured_on" < DATE '2026-08-20';

-- Listings carry denormalised "last known" fields that the sweep refreshes.
-- Left alone they would still show a price whose supporting observation has
-- just been deleted, so a product would display a price with an empty chart
-- beneath it -- exactly the "number without evidence" this project exists to
-- argue against.
--
-- last_success_at is cleared too, so the sweep treats these as never
-- successfully fetched and repopulates them on its next run.
UPDATE "marketplace_listings"
SET "current_price_minor" = NULL,
    "mrp_minor"           = NULL,
    "discount_percent"    = NULL,
    "last_success_at"     = NULL
--
-- Explicitly timestamptz at the Asia/Kolkata day boundary. last_success_at is
-- timestamptz, and comparing it against a naive timestamp would resolve using
-- whatever timezone the migration session happens to run in -- which on Render
-- is UTC, and would therefore clear 5.5 hours more than intended. Every
-- business date in this project is Asia/Kolkata, and this cutoff is no
-- exception.
WHERE "last_success_at" < TIMESTAMPTZ '2026-08-20 00:00:00+05:30';
