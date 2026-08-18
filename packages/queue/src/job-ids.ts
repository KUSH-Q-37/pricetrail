/**
 * The id of the fetch job for a listing on a given business day.
 *
 * One convention, deliberately shared between the user-facing ingest path and
 * the daily sweep. Both want the same outcome — this listing fetched once
 * today — and with different ids they would each enqueue their own, doubling
 * marketplace requests for every product searched on a day the sweep covers.
 *
 * The date component is what makes it per-day rather than per-listing. Without
 * it the id is permanent, and BullMQ drops every later enqueue for that
 * listing forever — which is how a re-search could silently fetch nothing.
 *
 * The date is passed in rather than computed here: business dates belong to
 * Asia/Kolkata and that logic lives in @pricetrail/database, which this
 * package deliberately does not depend on. Callers already import it.
 *
 * Hyphens, not colons: BullMQ reserves ':' in custom job ids.
 */
export function scrapeJobId(listingId: string, businessDateKey: string): string {
  return `fetch-${listingId}-${businessDateKey}`;
}
