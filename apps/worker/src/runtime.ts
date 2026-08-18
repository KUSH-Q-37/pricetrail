/**
 * The worker runtime, extracted from `main.ts` so it has two callers.
 *
 * Why this exists
 * ---------------
 * A separate worker process is the right architecture: scraping is slow and
 * memory-hungry, and it must never share an event loop with request handling.
 * That is still how this should run in production, and `apps/worker` remains a
 * deployable of its own.
 *
 * But a separate deployable has to actually be deployed. On a free hosting
 * tier with one service, "the API is live and the worker is not" is not a
 * misconfiguration the user can fix — it is the only shape available to them,
 * and the visible symptom is products that sit at "Fetching details" forever
 * because nothing is draining the queue.
 *
 * So the runtime is a function. `apps/worker/src/main.ts` calls it and does
 * nothing else. The API calls it when RUN_WORKERS_IN_API is set, which turns
 * one service into a complete system at the cost of sharing memory and CPU.
 * Flipping back to a dedicated worker later is an env var, not a code change.
 *
 * The trade-off is real and is documented at the call site in the API.
 */

import { PrismaClient, type Platform } from '@pricetrail/database';
import { LocalOnnxEmbeddingProvider } from '@pricetrail/embeddings';
import { AmazonAdapter, FlipkartAdapter, type MarketplaceAdapter } from '@pricetrail/marketplace';
import {
  QUEUE,
  QueueProducer,
  Worker,
  assertQueueSafeRedis,
  createRedisConnection,
  type DiscoverCounterpartJob,
  type EmbedListingJob,
  type Job,
  type MaintenanceJob,
  type MatchListingJob,
  type ScrapeListingJob,
} from '@pricetrail/queue';

import { applyRetention } from './jobs/apply-retention';
import { discoverCounterpart } from './jobs/discover-counterpart';
import { retireStaleTracking } from './jobs/retire-stale-tracking';
import { embedMissingListings } from './jobs/embed-listings';
import { planDailySweep } from './jobs/daily-sweep';
import { matchListing } from './jobs/match-listings';
import { scrapeListing } from './jobs/scrape-listing';
import { logger as defaultLogger } from './logger';

/** The subset of a logger this runtime needs, so the API can pass its own. */
export interface RuntimeLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface WorkerRuntimeOptions {
  redisUrl?: string;
  /**
   * Concurrent scrape jobs. A Playwright context costs 300-500 MB, so this
   * multiplied by the fallback rate is the real memory ceiling — set it by
   * available RAM, not by how fast you want the sweep to finish. Co-hosted
   * with the API on a small instance, this must be 1.
   */
  scrapeConcurrency?: number;
  /**
   * Reuse the caller's Prisma client instead of opening a second pool. The API
   * already holds one, and a free Postgres tier counts connections.
   */
  prisma?: PrismaClient;
  logger?: RuntimeLogger;
  /**
   * Register the repeatable daily-sweep and partition schedules. Idempotent —
   * BullMQ keys them by name+pattern in Redis, so every replica registering is
   * safe and it still fires exactly once cluster-wide.
   */
  registerSchedules?: boolean;
}

export interface WorkerRuntime {
  /** Closes workers, letting in-flight jobs finish first. */
  stop(): Promise<void>;
}

/**
 * Redis command budget.
 *
 * BullMQ is chatty when idle. Each worker re-issues a blocking read every
 * `drainDelay` seconds and runs a stalled-job check every `stalledInterval`
 * ms, per queue. At the defaults (5s / 30s) four queues cost roughly 250,000
 * Redis commands a day doing nothing at all — which exhausted a 500,000/month
 * free tier in two days and took the API down with it, because a Redis that
 * refuses AUTH is indistinguishable from a Redis that is gone.
 *
 * This workload is one sweep a day plus occasional user-triggered ingests.
 * Latency of up to a minute on job pickup is invisible for a price tracker;
 * running out of Redis is not. These values cut idle traffic by ~90%.
 *
 * Raise them only alongside a paid Redis plan.
 */
const POLL_BUDGET = {
  /** Seconds a blocking read waits before re-issuing. Default 5. */
  drainDelay: Number(process.env['QUEUE_DRAIN_DELAY'] ?? 60),
  /** Ms between stalled-job checks. Default 30_000. */
  stalledInterval: Number(process.env['QUEUE_STALLED_INTERVAL'] ?? 300_000),
} as const;

export async function startWorkerRuntime(
  options: WorkerRuntimeOptions = {},
): Promise<WorkerRuntime> {
  const logger = options.logger ?? defaultLogger;
  const redisUrl = options.redisUrl ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const scrapeConcurrency =
    options.scrapeConcurrency ?? Number(process.env['SCRAPE_CONCURRENCY'] ?? 4);

  const connection = createRedisConnection(redisUrl);
  await assertQueueSafeRedis(connection);

  // Only dispose what we created. Disconnecting a borrowed Prisma client on
  // shutdown would take the API's database access down with it.
  const ownsPrisma = options.prisma === undefined;
  const prisma = options.prisma ?? new PrismaClient();

  const producer = new QueueProducer(connection);
  const embeddings = new LocalOnnxEmbeddingProvider();

  const adapters: Record<Platform, MarketplaceAdapter> = {
    AMAZON: new AmazonAdapter({
      paapi:
        process.env['PAAPI_ACCESS_KEY'] &&
        process.env['PAAPI_SECRET_KEY'] &&
        process.env['PAAPI_PARTNER_TAG']
          ? {
              accessKey: process.env['PAAPI_ACCESS_KEY'],
              secretKey: process.env['PAAPI_SECRET_KEY'],
              partnerTag: process.env['PAAPI_PARTNER_TAG'],
            }
          : undefined,
      onStrategyFallback: (info) => logger.warn('fetch strategy escalated', { ...info }),
    }),
    FLIPKART: new FlipkartAdapter({
      // Affiliate credentials were never wired through. FlipkartAdapter has
      // accepted an `affiliate` option since the adapter was written and the
      // runtime constructed it without one, so FlipkartAffiliateFetcher was
      // always built unconfigured and the API strategy could not run — the
      // class existing was mistaken for the integration working.
      //
      // Both values or neither: a half-configured client fails at request
      // time with an auth error that looks like a credential problem rather
      // than a wiring one.
      affiliate:
        process.env['FLIPKART_AFFILIATE_ID'] && process.env['FLIPKART_AFFILIATE_TOKEN']
          ? {
              affiliateId: process.env['FLIPKART_AFFILIATE_ID'],
              affiliateToken: process.env['FLIPKART_AFFILIATE_TOKEN'],
            }
          : undefined,
      onStrategyFallback: (info) => logger.warn('fetch strategy escalated', { ...info }),
    }),
  };

  const workers: Worker[] = [];

  // --- scrape -------------------------------------------------------------
  workers.push(
    new Worker<ScrapeListingJob>(
      QUEUE.scrape,
      async (job: Job<ScrapeListingJob>) => {
        const result = await scrapeListing(
          { prisma, getAdapter: (platform) => adapters[platform] },
          {
            listingId: job.data.listingId,
            platform: job.data.platform,
            externalId: job.data.externalId,
            url: job.data.url,
            forceStrategy: job.data.forceStrategy,
            attempt: job.attemptsMade + 1,
            queueJobId: job.id,
          },
        );

        // Chain forward only on success. Embedding a listing whose fetch
        // failed would index a placeholder title — the exact bug Phase 10
        // surfaced.
        if (result.status === 'SUCCEEDED') {
          await producer.enqueue(QUEUE.embed, {
            listingId: job.data.listingId,
            correlationId: job.data.correlationId,
          });

          // Look for this product on the other marketplace. Only meaningful
          // after a successful fetch: the query is built from the title, and
          // a PENDING placeholder title searches for nothing useful.
          //
          // One discovery attempt per listing, ever — the id carries no date.
          // The opposite marketplace's catalogue does not change often enough
          // to justify re-searching daily, and each attempt costs a
          // rate-limited PA-API call.
          await producer.enqueue(
            QUEUE.discover,
            { listingId: job.data.listingId, correlationId: job.data.correlationId },
            { jobId: `discover-${job.data.listingId}` },
          );
        }

        return result;
      },
      { connection, concurrency: scrapeConcurrency, ...POLL_BUDGET },
    ),
  );

  // --- embed --------------------------------------------------------------
  workers.push(
    new Worker<EmbedListingJob>(
      QUEUE.embed,
      async (job: Job<EmbedListingJob>) => {
        const result = await embedMissingListings(prisma, embeddings, {
          batchSize: 32,
          maxBatches: 1,
        });

        // Matching needs BOTH sides embedded, so it is queued after the
        // embedding rather than alongside it.
        await producer.enqueue(QUEUE.match, {
          listingId: job.data.listingId,
          correlationId: job.data.correlationId,
        });

        return result;
      },
      { connection, concurrency: 1, ...POLL_BUDGET },
    ),
  );

  // --- match --------------------------------------------------------------
  workers.push(
    new Worker<MatchListingJob>(
      QUEUE.match,
      async (job: Job<MatchListingJob>) => matchListing(prisma, embeddings, job.data.listingId),
      { connection, concurrency: 2, ...POLL_BUDGET },
    ),
  );

  // --- discover counterpart -----------------------------------------------
  workers.push(
    new Worker<DiscoverCounterpartJob>(
      QUEUE.discover,
      async (job: Job<DiscoverCounterpartJob>) => {
        const result = await discoverCounterpart(
          prisma,
          (platform) => adapters[platform],
          job.data.listingId,
        );

        // Candidates are created unfetched; they need the normal pipeline to
        // become comparable. Scraping them chains into embed and match exactly
        // as a user-pasted URL does, and the matcher decides whether any of
        // them is actually the same product.
        for (const listingId of result.created) {
          const candidate = await prisma.marketplaceListing.findUnique({
            where: { id: listingId },
            select: { platform: true, externalId: true, url: true },
          });
          if (!candidate) continue;

          await producer.enqueue(QUEUE.scrape, {
            listingId,
            platform: candidate.platform,
            externalId: candidate.externalId,
            url: candidate.url,
            correlationId: job.data.correlationId,
          });
        }

        // Logged rather than thrown when unavailable. A marketplace with no
        // search source is a configuration fact, not a job failure, and
        // retrying it would burn the queue's retry budget on something that
        // cannot succeed until someone adds credentials.
        if (!result.searched) {
          logger.info('counterpart discovery skipped', {
            listingId: job.data.listingId,
            reason: result.reason ?? result.skipped,
            retryable: result.retryable ?? false,
          });
        }

        return result;
      },
      { connection, concurrency: 1, ...POLL_BUDGET },
    ),
  );

  // --- maintenance --------------------------------------------------------
  workers.push(
    new Worker<MaintenanceJob>(
      QUEUE.maintenance,
      async (job: Job<MaintenanceJob>) => {
        switch (job.data.task) {
          case 'daily-sweep':
            return planDailySweep(prisma, producer, {
              windowMinutes: Number(process.env['SWEEP_WINDOW_MINUTES'] ?? 360),
              correlationId: job.data.correlationId,
            });

          case 'ensure-partitions': {
            // Keeps three months of price_points partitions ahead. Without
            // this the first insert into an uncovered month fails outright —
            // there is deliberately no DEFAULT partition (see Phase 2).
            const rows = await prisma.$queryRaw<Array<{ ensure_price_point_partitions: string }>>`
              SELECT ensure_price_point_partitions(0, 3)
            `;
            return { partitions: rows.length };
          }

          case 'embed-backfill':
            return embedMissingListings(prisma, embeddings, { batchSize: 32 });

          case 'retention': {
            // Rolling window. Drops whole monthly partitions older than the
            // retention period rather than deleting rows — see
            // apply-retention.ts for why that distinction matters.
            const result = await applyRetention(prisma, {
              retentionMonths: Number(
                process.env['PRICE_HISTORY_RETENTION_MONTHS'] ?? 15,
              ),
            });

            // Logged explicitly, not just returned: this is the one scheduled
            // job that destroys data, and "what was removed and when" needs to
            // survive in the log even when nobody inspects the job result.
            logger.info('retention applied', {
              cutoff: result.cutoff,
              retentionMonths: result.retentionMonths,
              droppedCount: result.dropped.length,
              dropped: result.dropped,
            });

            return result;
          }

          case 'retire-tracking': {
            // Retention bounds storage; this bounds work. Without it the daily
            // fetch bill grows monotonically with every URL anyone has ever
            // pasted, until the sweep cannot finish inside its window.
            const result = await retireStaleTracking(prisma, {
              afterMonths: Number(process.env['TRACKING_RETIRE_AFTER_MONTHS'] ?? 12),
            });

            if (result.retired > 0 || result.skipped) {
              logger.info('tracking retirement', { ...result });
            }

            return result;
          }

          default:
            throw new Error(`Unknown maintenance task: ${String(job.data.task)}`);
        }
      },
      { connection, concurrency: 1, ...POLL_BUDGET },
    ),
  );

  for (const worker of workers) {
    worker.on('completed', (job) =>
      logger.info('job completed', { queue: worker.name, jobId: job.id }),
    );
    worker.on('failed', (job, error) =>
      logger.error('job failed', {
        queue: worker.name,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        correlationId: (job?.data as { correlationId?: string })?.correlationId,
        error: error.message,
      }),
    );
  }

  // --- schedules ----------------------------------------------------------
  // Registered on boot rather than from a separate scheduler process. The
  // Phase 1 sketch called for a dedicated single-replica scheduler, but that
  // requirement came from node-cron firing once per replica. BullMQ stores
  // repeatable schedules in Redis keyed by name+pattern, so registering from
  // every replica is idempotent and it still fires exactly once cluster-wide.
  if (options.registerSchedules !== false) {
    await producer.schedule(
      QUEUE.maintenance,
      { task: 'daily-sweep' },
      { pattern: '0 2 * * *', jobId: 'repeat-daily-sweep' },
    );
    await producer.schedule(
      QUEUE.maintenance,
      { task: 'ensure-partitions' },
      { pattern: '0 3 1 * *', jobId: 'repeat-ensure-partitions' },
    );
    // Daily, and deliberately after the sweep rather than before it. Running
    // retention first would mean the day's collection and the day's deletion
    // compete for the same connections on a small instance, for no benefit —
    // a partition that is 15 months old at 02:00 is still 15 months old at
    // 04:00.
    await producer.schedule(
      QUEUE.maintenance,
      { task: 'retention' },
      { pattern: '0 4 * * *', jobId: 'repeat-retention' },
    );
    // Weekly is enough: the cutoff moves by a month at a time, so running it
    // daily would scan the same rows seven times to find the same nothing.
    await producer.schedule(
      QUEUE.maintenance,
      { task: 'retire-tracking' },
      { pattern: '30 4 * * 0', jobId: 'repeat-retire-tracking' },
    );
  }

  // Logged at boot because "is the API path actually on?" was previously
  // unanswerable without reading code. A silent fallback to scraping looks
  // identical to a working integration until it breaks.
  logger.info('marketplace sources', {
    amazonPaapi: Boolean(
      process.env['PAAPI_ACCESS_KEY'] &&
        process.env['PAAPI_SECRET_KEY'] &&
        process.env['PAAPI_PARTNER_TAG'],
    ),
    flipkartAffiliate: Boolean(
      process.env['FLIPKART_AFFILIATE_ID'] && process.env['FLIPKART_AFFILIATE_TOKEN'],
    ),
  });

  logger.info('worker runtime ready', {
    queues: Object.values(QUEUE),
    scrapeConcurrency,
    embedded: !ownsPrisma,
  });

  return {
    // In-flight jobs must be allowed to finish. Killing a worker mid-fetch
    // leaves the job locked until BullMQ's stall timeout, delaying its retry
    // by minutes for no reason.
    async stop(): Promise<void> {
      await Promise.all(workers.map((worker) => worker.close()));
      await producer.close();
      await embeddings.dispose?.();
      if (ownsPrisma) await prisma.$disconnect();
      connection.disconnect();
    },
  };
}
