import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { businessDateKey } from '@pricetrail/database';
import {
  QUEUE,
  QueueProducer,
  createRedisConnection,
  scrapeJobId,
  type ScrapeListingJob,
} from '@pricetrail/queue';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { RequestContextStore } from '../../common/context/request-context';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Queue PRODUCER for the API.
 *
 * The API enqueues and never consumes — the architectural rule from Phase 1.
 * A Chromium context costs 300-500 MB and a fetch takes 5-40 s; doing that in
 * a request handler means one slow scrape degrades every API request and you
 * end up scaling API replicas by scraper memory instead of by traffic.
 *
 * Uses its own Redis connection rather than sharing RedisService's: BullMQ
 * requires `maxRetriesPerRequest: null`, and mixing that setting into the
 * connection the rate limiter uses would change its failure behaviour.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection;
  private readonly producer: QueueProducer;

  constructor(
    config: AppConfigService,
    @InjectPinoLogger(QueueService.name) private readonly logger: PinoLogger,
  ) {
    this.connection = createRedisConnection(config.redisUrl);
    this.producer = new QueueProducer(this.connection);
  }

  /**
   * Queue a fetch for a newly ingested listing.
   *
   * Failures are logged and swallowed. Ingest has already committed the
   * product row, so throwing here would fail a request whose durable work
   * succeeded — and the daily sweep will pick the listing up regardless
   * because it selects anything not yet observed today. A missed enqueue costs
   * latency, not data.
   */
  async enqueueScrape(job: ScrapeListingJob): Promise<void> {
    try {
      const outcome = await this.producer.enqueueOrPromote(
        QUEUE.scrape,
        { ...job, correlationId: job.correlationId ?? RequestContextStore.correlationId },
        {
          // Ingest is user-facing: jump ahead of the daily sweep's backlog.
          priority: 1,
          // One fetch per listing per business day, shared with the daily
          // sweep — see scrapeJobId(). The id used to be `ingest-<listingId>`
          // with no date, which made it permanent: BullMQ refuses a duplicate
          // id, so after the first search a listing could never be enqueued
          // from this path again. That is fatal to "search collects today's
          // price", because every search after the first silently did nothing.
          jobId: scrapeJobId(job.listingId, businessDateKey()),
        },
      );

      this.logger.debug({ listingId: job.listingId, outcome }, 'Scrape enqueue');
    } catch (error) {
      this.logger.error(
        { err: error, listingId: job.listingId },
        'Failed to enqueue scrape; the daily sweep will retry this listing',
      );
    }
  }

  /** Queue depths, for the admin health view. */
  async stats(): Promise<Record<string, Record<string, number>>> {
    const entries = await Promise.all(
      this.producer.allQueueNames.map(async (name) => [name, await this.producer.counts(name)] as const),
    );
    return Object.fromEntries(entries);
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.close();
    this.connection.disconnect();
  }
}
