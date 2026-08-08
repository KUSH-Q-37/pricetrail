-- ===========================================================================
-- price_points partition management
--
-- price_points is RANGE-partitioned by captured_on (see the init migration).
-- A partitioned parent holds no rows itself: without a partition covering a
-- given date, INSERT fails with "no partition of relation found for row".
--
-- DESIGN NOTE — there is deliberately NO default partition.
--
-- A default partition looks like a safety net but is a trap: rows for a
-- missing month land in it silently, and afterwards Postgres refuses to
-- create the real partition for that month (it would have to move rows that
-- already violate the new boundary). You end up unable to partition the very
-- month that is filling up. Failing loudly on a missing partition is the
-- safer behaviour — the scheduler surfaces it as a job error on day one
-- instead of a migration deadlock months later.
--
-- Partitions are therefore created ahead of time, and a monthly maintenance
-- job (Phase 11) calls ensure_price_point_partitions(0, 3) to stay ahead.
-- ===========================================================================

-- Create the monthly partition covering `target_month`, if it does not exist.
-- Idempotent and safe to call concurrently with itself on different months.
CREATE OR REPLACE FUNCTION ensure_price_point_partition(target_month DATE)
RETURNS TEXT
LANGUAGE plpgsql
AS $fn$
DECLARE
    start_date DATE := date_trunc('month', target_month)::date;
    end_date   DATE := (date_trunc('month', target_month) + INTERVAL '1 month')::date;
    part_name  TEXT := 'price_points_' || to_char(date_trunc('month', target_month), 'YYYY_MM');
BEGIN
    IF to_regclass('public.' || quote_ident(part_name)) IS NOT NULL THEN
        RETURN part_name || ' (already exists)';
    END IF;

    EXECUTE format(
        'CREATE TABLE %I PARTITION OF price_points FOR VALUES FROM (%L) TO (%L)',
        part_name, start_date, end_date
    );

    RETURN part_name || ' (created)';
END;
$fn$;

COMMENT ON FUNCTION ensure_price_point_partition(DATE) IS
    'Creates the monthly price_points partition covering the given month. Idempotent.';

-- Create a contiguous window of monthly partitions around today.
CREATE OR REPLACE FUNCTION ensure_price_point_partitions(
    months_back    INT DEFAULT 1,
    months_forward INT DEFAULT 12
)
RETURNS SETOF TEXT
LANGUAGE plpgsql
AS $fn$
DECLARE
    m DATE;
BEGIN
    FOR m IN
        SELECT gs::date
        FROM generate_series(
            date_trunc('month', CURRENT_DATE) - make_interval(months => months_back),
            date_trunc('month', CURRENT_DATE) + make_interval(months => months_forward),
            INTERVAL '1 month'
        ) AS gs
    LOOP
        RETURN NEXT ensure_price_point_partition(m);
    END LOOP;
END;
$fn$;

COMMENT ON FUNCTION ensure_price_point_partitions(INT, INT) IS
    'Ensures monthly price_points partitions exist across the given window. Run monthly by the scheduler.';

-- Seed the initial window: 18 months behind, 12 months ahead.
--
-- 18 months back matches the longest chart range the product offers (1.5Y),
-- so a historical backfill or an out-of-order observation has somewhere to
-- land. An empty partition costs a few KB and one index, so a generous
-- window is far cheaper than an insert failing in production at 02:00.
SELECT ensure_price_point_partitions(18, 12);
