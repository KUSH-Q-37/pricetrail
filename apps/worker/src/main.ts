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
import { logger } from './logger';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

/**
 * Worker concurrency.
 *
 * Deliberately small. A Playwright context costs 300-500 MB, so this number
 * multiplied by the fallback rate is the worker's real memory ceiling — set it
 * by available RAM, not by how fast you would like the sweep to finish.
 */
const SCRAPE_CONCURRENCY = Number(process.env['SCRAPE_CONCURRENCY'] ?? 4);

async function main(): Promise<void> {
  const connection = createRedisConnection(REDIS_URL);
  await assertQueueSafeRedis(connection);

  const prisma = new PrismaClient();
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
      onStrategyFallback: (info) =>
        logger.warn('fetch strategy escalated', { ...info }),
    }),
    FLIPKART: new FlipkartAdapter({
      onStrategyFallback: (info) =>
        logger.warn('fetch strategy escalated', { ...info }),
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
      { connection, concurrency: SCRAPE_CONCURRENCY },
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
      async (job: Job<MatchListingJob>) =>
        matchListing(prisma, embeddings, job.data.listingId),
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
  // Registered from the worker on boot rather than from a separate scheduler
  // process. The Phase 1 sketch called for a dedicated single-replica
  // scheduler, but that requirement came from node-cron firing once per
  // replica. BullMQ stores repeatable schedules in Redis keyed by
  // name+pattern, so registering from every replica is idempotent and it still
  // fires exactly once cluster-wide — the extra deployable buys nothing.
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

  logger.info('worker ready', {
    queues: Object.values(QUEUE),
    scrapeConcurrency: SCRAPE_CONCURRENCY,
  });

  // --- shutdown -----------------------------------------------------------
  // SIGTERM must let in-flight jobs finish. Killing a worker mid-fetch leaves
  // the job locked until BullMQ's stall timeout, delaying its retry by
  // minutes for no reason.
  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    await Promise.all(workers.map((worker) => worker.close()));
    await producer.close();
    await Promise.all([prisma.$disconnect(), embeddings.dispose?.()]);
    connection.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  logger.error('worker failed to start', { error: String(error) });
  process.exit(1);
});
