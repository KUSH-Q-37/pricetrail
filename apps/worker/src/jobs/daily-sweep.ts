import type { PrismaClient } from '@pricetrail/database';
import { QUEUE, type QueueProducer } from '@pricetrail/queue';

export interface SweepResult {
  due: number;
  enqueued: number;
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
 * The window is deliberately configurable: on the PA-API path, GetItems
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

  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  // Served by the partial index on (tracking_enabled, last_scraped_at).
  // NULLS FIRST puts never-fetched listings at the front of the queue.
  const due = await prisma.marketplaceListing.findMany({
    where: {
      trackingEnabled: true,
      NOT: { pricePoints: { some: { capturedOn: startOfDayUtc } } },
    },
    select: { id: true, platform: true, externalId: true, url: true },
    orderBy: { lastScrapedAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
  });

  if (due.length === 0) {
    return { due: 0, enqueued: 0, windowMinutes };
  }

  const windowMs = windowMinutes * 60_000;

  const enqueued = await producer.enqueueBulk(
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
        // Idempotent per listing per day: if the sweep is triggered twice
        // (manual run plus the cron), the second enqueue is a no-op rather
        // than a duplicate fetch. Hyphen-separated because BullMQ rejects
        // ':' in custom job IDs.
        jobId: `sweep-${listing.id}-${startOfDayUtc.toISOString().slice(0, 10)}`,
      },
    })),
  );

  return { due: due.length, enqueued, windowMinutes };
}
