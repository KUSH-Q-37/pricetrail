import { businessMonthStartMinusMonths, type PrismaClient } from '@pricetrail/database';

export interface RetentionResult {
  retentionMonths: number;
  cutoff: string;
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

  // dry_run = false. The SQL function defaults to true precisely so that a
  // caller has to say this out loud.
  const rows = await prisma.$queryRaw<Array<{ partition_name: string; action: string }>>`
    SELECT partition_name, action
    FROM drop_price_point_partitions_before(${cutoff}::date, false)
  `;

  return {
    retentionMonths,
    cutoff,
    dropped: rows.map((row) => row.partition_name),
  };
}
