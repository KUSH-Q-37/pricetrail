import { businessMonthStartMinusMonths, type PrismaClient } from '@pricetrail/database';

export interface RetentionResult {
  retentionMonths: number;
  cutoff: string;
  /**
   * Intervals re-anchored at the cutoff because they began before it and are
   * still live. Normally zero; non-zero means a price held across the whole
   * retention window, which is worth seeing rather than inferring.
   */
  carriedForward: number;
  dropped: string[];
}

/**
 * Default retention: 15 months.
 *
 * Matches the longest range the UI offers. Keeping more would mean storing
 * data no screen can reach; keeping less would mean a range that renders
 * empty for reasons a user cannot see.
 */
export const DEFAULT_RETENTION_MONTHS = 15;

/**
 * Drop price history older than the retention window.
 *
 * Partition drops, not row deletes. DROP TABLE is constant-time and returns
 * the space immediately; deleting a month of rows is a full scan that writes
 * as much WAL as it removes and leaves the space to VACUUM.
 *
 * The cutoff is the first day of the month N months before today's *business*
 * date, so it lands on a partition boundary and cannot bisect a month. The SQL
 * function refuses to drop any partition whose range extends past the cutoff,
 * so the boundary month is kept in full rather than partially removed.
 *
 * Safe to run repeatedly: once a month's partition is gone the next call finds
 * nothing to do.
 */
export async function applyRetention(
  prisma: PrismaClient,
  options: { retentionMonths?: number; now?: Date } = {},
): Promise<RetentionResult> {
  const retentionMonths = options.retentionMonths ?? DEFAULT_RETENTION_MONTHS;

  if (!Number.isInteger(retentionMonths) || retentionMonths < 1) {
    throw new Error(`retentionMonths must be a positive integer, got ${retentionMonths}`);
  }

  const cutoffDate = businessMonthStartMinusMonths(retentionMonths, options.now ?? new Date());
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  // Carry forward any interval that STARTS before the cutoff but is still
  // live, before the partition holding it is dropped.
  //
  // Rows are change intervals now, so a price set eighteen months ago and
  // unchanged since is a single row sitting in an eighteen-month-old
  // partition — while describing today. Dropping that partition would delete
  // the current price and leave the product with no history at all, which is
  // the exact opposite of what a retention window is supposed to do.
  //
  // The fix is to re-anchor it at the cutoff: insert an equivalent row dated
  // the first retained day, keeping its last_confirmed_on. The old row then
  // drops harmlessly with its partition, and no observation is invented —
  // every day the new row claims was already claimed by the old one.
  //
  // ON CONFLICT DO NOTHING because a row may already exist at the cutoff date
  // if the price changed that very day; the existing one is the more precise
  // record and must win.
  const carried = await prisma.$executeRaw`
    INSERT INTO price_points (
      listing_id, captured_on, last_confirmed_on, captured_at,
      currency, price_minor, mrp_minor, discount_percent, availability, source
    )
    SELECT
      listing_id, ${cutoff}::date, last_confirmed_on, captured_at,
      currency, price_minor, mrp_minor, discount_percent, availability, source
    FROM price_points
    WHERE captured_on < ${cutoff}::date
      AND last_confirmed_on >= ${cutoff}::date
    ON CONFLICT (listing_id, captured_on) DO NOTHING
  `;

  // dry_run = false. The SQL function defaults to true precisely so that a
  // caller has to say this out loud.
  const rows = await prisma.$queryRaw<Array<{ partition_name: string; action: string }>>`
    SELECT partition_name, action
    FROM drop_price_point_partitions_before(${cutoff}::date, false)
  `;

  return {
    retentionMonths,
    cutoff,
    carriedForward: carried,
    dropped: rows.map((row) => row.partition_name),
  };
}
