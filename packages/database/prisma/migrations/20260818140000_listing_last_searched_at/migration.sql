-- When a user last searched this listing's URL.
--
-- Searching is what enrols a listing in global tracking, so without this the
-- tracked set could only grow: nothing recorded whether anyone still cared.
-- Retirement stands down listings nobody has searched in a long time, and a
-- single search revives one immediately.
ALTER TABLE "marketplace_listings"
  ADD COLUMN IF NOT EXISTS "last_searched_at" TIMESTAMPTZ(3);

-- Partial index: retirement only ever scans tracked rows, and on a catalogue
-- where most listings are tracked this still avoids reading the untracked tail.
CREATE INDEX IF NOT EXISTS "marketplace_listings_tracking_last_searched_idx"
  ON "marketplace_listings" ("last_searched_at")
  WHERE "tracking_enabled" = true;
