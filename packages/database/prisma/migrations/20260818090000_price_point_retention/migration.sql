-- ===========================================================================
-- Rolling retention for price_points.
--
-- The product keeps a rolling 15-month window. Beyond that the data is not
-- shown anywhere and only costs storage on a 500 MB free tier.
--
-- Dropping whole partitions rather than DELETE-ing rows:
--   - DROP TABLE is O(1) and reclaims the space immediately. A DELETE of a
--     month's rows is a full scan, writes as much WAL as the data it removes,
--     leaves the space to VACUUM, and bloats the index.
--   - It cannot partially fail and leave a month half-deleted.
--
-- SAFETY. This function removes data permanently, so it is deliberately
-- conservative:
--   - It only drops a partition whose month ends AT OR BEFORE the cutoff, so
--     a partition straddling the boundary is never touched.
--   - It only drops tables that are genuinely partitions of price_points,
--     verified through pg_inherits — never anything merely matching the name.
--   - dry_run defaults to TRUE. A caller must ask explicitly to delete.
-- ===========================================================================

CREATE OR REPLACE FUNCTION drop_price_point_partitions_before(
    cutoff  DATE,
    dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (partition_name TEXT, month_start DATE, action TEXT)
LANGUAGE plpgsql
AS $fn$
DECLARE
    part        RECORD;
    part_month  DATE;
    part_end    DATE;
BEGIN
    IF cutoff IS NULL THEN
        RAISE EXCEPTION 'cutoff must not be NULL';
    END IF;

    -- A cutoff in the future would drop live data. Refuse rather than trust
    -- the caller's arithmetic.
    IF cutoff > CURRENT_DATE THEN
        RAISE EXCEPTION 'cutoff % is in the future; refusing to drop partitions', cutoff;
    END IF;

    FOR part IN
        SELECT c.relname::text AS name
        FROM pg_inherits i
        JOIN pg_class c      ON c.oid = i.inhrelid
        JOIN pg_class parent ON parent.oid = i.inhparent
        WHERE parent.relname = 'price_points'
          AND c.relname ~ '^price_points_[0-9]{4}_[0-9]{2}$'
        ORDER BY c.relname
    LOOP
        part_month := to_date(substring(part.name from 14), 'YYYY_MM');
        part_end   := (part_month + INTERVAL '1 month')::date;

        -- Strictly outside the window: the last day this partition can hold
        -- is still before the cutoff.
        IF part_end <= cutoff THEN
            IF dry_run THEN
                partition_name := part.name;
                month_start    := part_month;
                action         := 'would drop';
                RETURN NEXT;
            ELSE
                EXECUTE format('DROP TABLE IF EXISTS %I', part.name);
                partition_name := part.name;
                month_start    := part_month;
                action         := 'dropped';
                RETURN NEXT;
            END IF;
        END IF;
    END LOOP;
END;
$fn$;

COMMENT ON FUNCTION drop_price_point_partitions_before(DATE, BOOLEAN) IS
    'Drops price_points partitions entirely older than the cutoff. dry_run defaults to TRUE; pass FALSE to actually drop.';
