-- Remove the user layer.
--
-- The product is now fully public: there is no sign-in, and searching a URL is
-- what enrols it in global tracking. Per-user state therefore has nothing to
-- attach to.
--
--   tracked_products  a user's favourites. Global collection stopped depending
--                     on these when search became the trigger, leaving them as
--                     a list nobody could log in to see.
--   price_alerts      never referenced by any code path; schema only.
--   match_reviews     never referenced by any code path; schema only. Human
--                     review of NEEDS_REVIEW matches presumes a reviewer
--                     identity, which no longer exists.
--   users             nothing remains that points at it.
--
-- Price history is untouched: price_points hangs off marketplace_listings and
-- was never related to a user. Nothing observed is lost here.
--
-- Order matters — children before parents, so the FKs go quietly.
DROP TABLE IF EXISTS "match_reviews";
DROP TABLE IF EXISTS "price_alerts";
DROP TABLE IF EXISTS "tracked_products";
DROP TABLE IF EXISTS "users";

-- Enums that existed only to describe users or the review flow.
DROP TYPE IF EXISTS "ReviewDecision";
DROP TYPE IF EXISTS "AlertStatus";
DROP TYPE IF EXISTS "PlanTier";
DROP TYPE IF EXISTS "UserRole";
