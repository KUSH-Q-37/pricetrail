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
 * is the entirety of what the system knows about who wants it. For products
 * the catalogue crawler enrolled, which nobody ever searched, createdAt stands
 * in for the same signal.
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
      OR: [
        // Searched at some point, and not since the cutoff.
        { lastSearchedAt: { not: null, lt: cutoffDate } },

        // Never searched by anyone, and old enough that this is now evidence
        // rather than absence of it.
        //
        // NULL used to be blanket-protected, on the reasoning that listings
        // predating the column should not be stood down for want of a record.
        // Catalogue discovery gave NULL a second meaning: enrolled by the
        // crawler, wanted by nobody. Those are the majority now, and if they
        // can never retire, the tracked set only grows — until it hits the cap,
        // at which point a product somebody actually searches cannot get in
        // because the budget is full of items nobody has ever opened.
        //
        // createdAt is what makes this safe for the original case too: a
        // legacy listing is only retired if it has ALSO existed, unsearched,
        // for the full retirement window. And retiring is still not deleting —
        // one search sets trackingEnabled back to true with its history intact.
        { lastSearchedAt: null, createdAt: { lt: cutoffDate } },
      ],
    },
    data: { trackingEnabled: false },
  });

  return {
    afterMonths,
    cutoff: cutoffDate.toISOString().slice(0, 10),
    retired: result.count,
  };
}
