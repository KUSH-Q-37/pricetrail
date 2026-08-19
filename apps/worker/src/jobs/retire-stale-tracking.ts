import { businessMonthStartMinusMonths, type PrismaClient } from '@pricetrail/database';

export interface RetirementResult {
  afterMonths: number;
  cutoff: string;
  retired: number;
  skipped?: string;
}

/**
 * Months of disinterest before a listing stops being collected.
 *
 * 12 is chosen against the 15-month retention window: a product searched once
 * still accumulates a full year of history, which is enough for every chart
 * range below the longest, before it stands down.
 */
export const DEFAULT_RETIRE_AFTER_MONTHS = 12;

/**
 * Stand down listings nobody has searched or favourited in a long time.
 *
 * Why this is needed
 * ------------------
 * Searching enrols a listing in daily collection and nothing ever removed it,
 * so the fetch bill grew monotonically with every URL anyone had ever pasted.
 * Retention bounds storage; this bounds *work*. Without it the two diverge
 * until the daily sweep cannot finish inside its window.
 *
 * Why it is safe
 * --------------
 * Retiring is not deleting. `trackingEnabled = false` stops future fetches and
 * touches nothing already observed, and ingest sets it back to true
 * unconditionally — so a single search revives a listing instantly, with its
 * entire history intact.
 *
 * lastSearchedAt is the only signal left. There are no accounts, so there is
 * no favourites list to consult — if nobody has searched a URL in a year, that
 * is the entirety of what the system knows about who wants it.
 *
 * Set TRACKING_RETIRE_AFTER_MONTHS=0 to disable, which is the right setting
 * while the catalogue is small enough that the sweep costs nothing.
 */
export async function retireStaleTracking(
  prisma: PrismaClient,
  options: { afterMonths?: number; now?: Date } = {},
): Promise<RetirementResult> {
  const afterMonths = options.afterMonths ?? DEFAULT_RETIRE_AFTER_MONTHS;

  if (afterMonths === 0) {
    return { afterMonths, cutoff: '', retired: 0, skipped: 'retirement disabled' };
  }
  if (!Number.isInteger(afterMonths) || afterMonths < 0) {
    throw new Error(`afterMonths must be a non-negative integer, got ${afterMonths}`);
  }

  const cutoffDate = businessMonthStartMinusMonths(afterMonths, options.now ?? new Date());

  const result = await prisma.marketplaceListing.updateMany({
    where: {
      trackingEnabled: true,
      // NULL means "never searched through the new ingest path" — listings that
      // predate the column. Those are deliberately NOT retired: absence of a
      // record is not evidence of disinterest, and silently standing down every
      // pre-existing listing on first run would be the worst possible outcome
      // of adding a column. They retire naturally once searched and left alone.
      lastSearchedAt: { not: null, lt: cutoffDate },
    },
    data: { trackingEnabled: false },
  });

  return {
    afterMonths,
    cutoff: cutoffDate.toISOString().slice(0, 10),
    retired: result.count,
  };
}
