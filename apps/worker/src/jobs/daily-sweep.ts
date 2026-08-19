import { businessDate, businessDateKey, type PrismaClient } from '@pricetrail/database';
import { QUEUE, scrapeJobId, type QueueProducer } from '@pricetrail/queue';

export interface SweepResult {
  /** Listings tracked and not yet observed today. */
  due: number;
  /**
   * Jobs handed to BullMQ — NOT jobs created.
   *
   * Named `submitted` deliberately. Job ids are per listing per business day,
   * so a second run submits the same ids and BullMQ drops them. The previous
   * name reported 5 on a re-run that created nothing, which reads as a
   * duplicate-fetch bug when the dedup is in fact working.
   */
  submitted: number;
  windowMinutes: number;
}

/**
 * Fan out the day's fetches.
 *
 * Two things this must get right:
 *
 * 1. ONLY listings not already observed today. `price_points` has one row per
 *    listing per day, so re-fetching one already captured is pure waste — and
 *    after a partial failure yesterday, a naive "fetch everything" re-runs the
 *    successes too.
 *
 * 2. JITTER. Enqueueing 50 000 jobs with no delay means 50 000 near-
 *    simultaneous requests to two hosts, which is indistinguishable from an
 *    attack and gets the whole IP range blocked within minutes. Each job gets
 *    a random delay spread across a multi-hour window so the load is flat.
 *
 * The window is deliberately configurable: on the Creators API path, getItems
 * batches 10 ASINs per call and the whole sweep fits in ~17 minutes, so a
 * 6-hour spread would be pointlessly slow.
 */
export async function planDailySweep(
  prisma: PrismaClient,
  producer: QueueProducer,
  options: { windowMinutes?: number; correlationId?: string; limit?: number } = {},
): Promise<SweepResult> {
  const windowMinutes = options.windowMinutes ?? 360;
  const limit = options.limit ?? 100_000;

  // The business date in Asia/Kolkata, not the UTC date.
  //
  // The cron that triggers this fires at 02:00 IST = 20:30 UTC the previous
  // day, so a UTC-derived "today" asked whether yesterday had been observed.
  // It must agree with what scrapeListing writes into captured_on, or the
  // sweep re-fetches listings it already has and skips ones it does not.
  const today = businessDate();
  const todayKey = businessDateKey();

  // Served by the partial index on (tracking_enabled, last_scraped_at).
  // NULLS FIRST puts never-fetched listings at the front of the queue.
  const due = await prisma.marketplaceListing.findMany({
    where: {
      trackingEnabled: true,
      NOT: { pricePoints: { some: { capturedOn: today } } },
    },
    select: { id: true, platform: true, externalId: true, url: true },
    orderBy: { lastScrapedAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
  });

  if (due.length === 0) {
    return { due: 0, submitted: 0, windowMinutes };
  }

  const windowMs = windowMinutes * 60_000;

  const submitted = await producer.enqueueBulk(
    QUEUE.scrape,
    due.map((listing) => ({
      payload: {
        listingId: listing.id,
        platform: listing.platform,
        externalId: listing.externalId,
        url: listing.url,
        correlationId: options.correlationId,
      },
      options: {
        delay: Math.floor(Math.random() * windowMs),
        // Idempotent per listing per business day, and shared with the
        // ingest path so a searched product is not fetched twice today.
        jobId: scrapeJobId(listing.id, todayKey),
      },
    })),
  );

  return { due: due.length, submitted, windowMinutes };
}
