/**
 * Queue names and job payloads.
 *
 * Shared by the API (which only ever PRODUCES) and the worker (which only
 * CONSUMES). Keeping the names and payload types in one package is what stops
 * the two sides drifting — a producer enqueueing `{listingId}` while the
 * consumer destructures `{id}` is a silent runtime failure that no compiler
 * catches when each side declares its own shape.
 */
/**
 * NOTE ON NAMING: no colons.
 *
 * BullMQ uses ':' as its internal Redis key separator (`bull:<queue>:<id>`)
 * and rejects any queue name containing one — "Queue name cannot contain :".
 * The natural-looking `scrape:listing` throws at construction, and because
 * queues are built lazily the failure surfaces at first enqueue rather than at
 * import, so a unit test that calls the job function directly never sees it.
 */
export const QUEUE = {
  scrape: 'scrape-listing',
  embed: 'embed-listing',
  match: 'match-listing',
  /** Finds a listing's counterpart on the opposite marketplace. */
  discover: 'discover-counterpart',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export type FetchStrategyName = 'API' | 'HTTP_CHEERIO' | 'PLAYWRIGHT';

/** Fields every job carries, so a log line anywhere can be traced to its origin. */
interface BaseJob {
  /**
   * Propagated from the HTTP request that started the chain.
   *
   * This is the whole reason Phase 3 put the correlation ID in
   * AsyncLocalStorage rather than a request-scoped provider: it has to survive
   * into code with no access to the DI container, and then across a process
   * boundary into the worker. Without it, "the user says their product never
   * loaded" is unanswerable.
   */
  correlationId?: string;
}

export interface ScrapeListingJob extends BaseJob {
  listingId: string;
  platform: 'AMAZON' | 'FLIPKART';
  externalId: string;
  url: string;
  /** Bypass the adapter's escalation ladder (admin "re-fetch with browser"). */
  forceStrategy?: FetchStrategyName;
}

export interface EmbedListingJob extends BaseJob {
  listingId: string;
}

export interface MatchListingJob extends BaseJob {
  listingId: string;
}

export interface DiscoverCounterpartJob extends BaseJob {
  listingId: string;
}

export type MaintenanceTask =
  | 'daily-sweep'
  | 'ensure-partitions'
  | 'embed-backfill'
  /** Drops price_points partitions older than the retention window. */
  | 'retention'
  /** Stops collecting listings nobody has searched or favourited in a long time. */
  | 'retire-tracking'
  /** Enrols products nobody has searched, so the catalogue grows on its own. */
  | 'discover-catalogue'
  /** Applies tracking scope to listings already in the catalogue. */
  | 'reclassify-catalogue';

export interface MaintenanceJob extends BaseJob {
  task: MaintenanceTask;
}

/** Maps a queue name to its payload type, so producers cannot mismatch. */
export interface JobPayloads {
  [QUEUE.scrape]: ScrapeListingJob;
  [QUEUE.embed]: EmbedListingJob;
  [QUEUE.match]: MatchListingJob;
  [QUEUE.discover]: DiscoverCounterpartJob;
  [QUEUE.maintenance]: MaintenanceJob;
}
