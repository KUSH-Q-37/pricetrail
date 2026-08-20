-- Store price history as CHANGE INTERVALS rather than one row per day.
--
-- Before: a row for every product, every day, whether the price moved or not.
-- A phone sitting at Rs 45,990 for sixty days cost sixty identical rows.
--
-- After: a row is written when the price CHANGES. While it holds, the existing
-- row's last_confirmed_on is extended. The same sixty days cost one row.
--
--   Aug 20  Rs 50,000  -> INSERT (captured_on Aug 20, last_confirmed_on Aug 20)
--   Aug 21  Rs 50,000  -> UPDATE (last_confirmed_on Aug 21)
--   Aug 22  Rs 50,000  -> UPDATE (last_confirmed_on Aug 22)
--   Aug 24  Rs 49,000  -> INSERT (captured_on Aug 24, last_confirmed_on Aug 24)
--
-- WHY last_confirmed_on EXISTS AT ALL
-- -----------------------------------
-- Change-only storage on its own destroys the difference between "the price
-- did not move for twenty days" and "we were broken for twenty days". Both
-- appear as an absence of rows, and they are opposite facts: one is a finding
-- about the market, the other is a finding about us. This project breaks the
-- chart line at gaps and states how many days are missing, and it can only do
-- that if presence and absence remain unambiguous.
--
-- captured_on..last_confirmed_on is therefore a CLOSED INTERVAL OF DAYS WE
-- ACTUALLY CHECKED. A day inside it was observed and the price was this. A day
-- in no interval was never observed, and stays a gap.
--
-- The consequence for the writer: an interval may only be extended when the
-- previous check was YESTERDAY. Extending across a missed day would claim an
-- observation that never happened, which is the one thing this schema exists
-- to prevent.

ALTER TABLE "price_points"
  ADD COLUMN IF NOT EXISTS "last_confirmed_on" DATE;

-- Existing rows were one-per-day, so each was confirmed on exactly the day it
-- was captured. Backfilling to captured_on makes every historical row a
-- one-day interval, which is precisely what it was.
UPDATE "price_points"
SET "last_confirmed_on" = "captured_on"
WHERE "last_confirmed_on" IS NULL;

ALTER TABLE "price_points"
  ALTER COLUMN "last_confirmed_on" SET NOT NULL;

-- An interval cannot end before it starts.
ALTER TABLE "price_points"
  ADD CONSTRAINT "price_points_interval_valid"
  CHECK ("last_confirmed_on" >= "captured_on");

-- Reads are "which intervals overlap this window", which needs the end of the
-- interval, not just the start. Without this, answering a 15-month chart means
-- scanning every row for the listing.
CREATE INDEX IF NOT EXISTS "price_points_listing_confirmed_idx"
  ON "price_points" ("listing_id", "last_confirmed_on" DESC);
