/**
 * The application's notion of "which day an observation belongs to".
 *
 * Why this exists
 * ---------------
 * price_points is keyed on (listing_id, captured_on) — one observation per
 * listing per day — and captured_on was computed with getUTCDate(). The
 * scheduler, meanwhile, fires on a cron with tz Asia/Kolkata. Those two
 * disagree: 02:00 IST is 20:30 UTC the previous day, so the day boundary
 * landed at 05:30 IST rather than midnight, and an observation taken at
 * 00:30 IST on the 18th was filed under the 17th.
 *
 * Nothing looked broken — the dates were consistent with each other, just
 * consistently shifted — which is exactly why it survived. A price recorded
 * "today" could silently overwrite yesterday's row, or leave today with none.
 *
 * Business rule: the day is the calendar day in Asia/Kolkata. Instants are
 * still stored in UTC (captured_at); only the *bucket* is local.
 */

/** The business timezone. India has no DST, but this is not assumed below. */
export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

/**
 * Calendar date parts in a timezone, via Intl rather than a fixed offset.
 *
 * A hardcoded +05:30 would be correct for India today and wrong the moment
 * this is pointed at a zone that observes DST. Intl consults the tz database,
 * so the helper stays honest if APP_TIMEZONE ever changes.
 */
function partsInZone(at: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);

  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value);

  return { y: get('year'), m: get('month'), d: get('day') };
}

/**
 * The business date an instant belongs to, as a UTC-midnight Date.
 *
 * UTC midnight is what Postgres `date` columns and Prisma's `@db.Date` expect.
 * The value carries no time-of-day meaning — it is a bucket label.
 */
export function businessDate(at: Date = new Date(), timeZone = BUSINESS_TIMEZONE): Date {
  const { y, m, d } = partsInZone(at, timeZone);
  return new Date(Date.UTC(y, m - 1, d));
}

/** `YYYY-MM-DD` in the business timezone. For job IDs and logs. */
export function businessDateKey(at: Date = new Date(), timeZone = BUSINESS_TIMEZONE): string {
  const { y, m, d } = partsInZone(at, timeZone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * The business date `days` before the given one.
 *
 * Arithmetic on the UTC-midnight bucket, not on a local instant, so it cannot
 * drift across a DST boundary in zones that have one.
 */
export function businessDateMinusDays(days: number, from: Date = new Date()): Date {
  const base = businessDate(from);
  return new Date(base.getTime() - days * 86_400_000);
}

/**
 * First day of the month `months` before the given business date.
 *
 * Used by retention: partitions are monthly, so the cutoff is a month
 * boundary. Month arithmetic via Date.UTC handles year rollover and short
 * months without special cases.
 */
export function businessMonthStartMinusMonths(months: number, from: Date = new Date()): Date {
  const base = businessDate(from);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - months, 1));
}
