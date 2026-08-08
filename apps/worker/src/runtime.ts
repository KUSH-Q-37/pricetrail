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
  type EmbedListingJob,
  type Job,
  type MaintenanceJob,
  type MatchListingJob,
  type ScrapeListingJob,
} from '@pricetrail/queue';

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
        }

        return result;
      },
      { connection, concurrency: scrapeConcurrency },
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
      { connection, concurrency: 1 },
    ),
  );

  // --- match --------------------------------------------------------------
  workers.push(
    new Worker<MatchListingJob>(
      QUEUE.match,
      async (job: Job<MatchListingJob>) => matchListing(prisma, embeddings, job.data.listingId),
      { connection, concurrency: 2 },
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

          default:
            throw new Error(`Unknown maintenance task: ${String(job.data.task)}`);
        }
      },
      { connection, concurrency: 1 },
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
  }

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
