import { Redis, type RedisOptions } from 'ioredis';

/**
 * Redis connection tuned for BullMQ.
 *
 * `maxRetriesPerRequest: null` is REQUIRED, not a preference. BullMQ workers
 * hold a blocking `BRPOPLPUSH` open for up to 30 seconds while waiting for a
 * job; with ioredis's default retry limit that blocking call is treated as a
 * stalled command and aborted, so the worker throws
 * "Connection is closed" under perfectly normal idle conditions. BullMQ
 * refuses to start without this and the error message does not explain why.
 */
export function createRedisConnection(url: string, overrides: RedisOptions = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // A worker restarting into a Redis that is still booting should wait, not
    // crash-loop the container.
    retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
    ...overrides,
  });
}

/**
 * Verify Redis is configured safely for queue use.
 *
 * BullMQ stores job state in ordinary Redis keys. Under any eviction policy
 * other than `noeviction`, Redis silently deletes those keys when it hits
 * maxmemory — queued jobs vanish, in-flight jobs lose their lock, and nothing
 * anywhere reports an error. The failure looks like "some products just never
 * got scraped", which is close to undiagnosable after the fact.
 *
 * Checked at startup so a misconfigured deployment fails loudly instead.
 */
export async function assertQueueSafeRedis(connection: Redis): Promise<void> {
  const config = await connection.config('GET', 'maxmemory-policy');
  // Reply is a flat [key, value] array.
  const policy = Array.isArray(config) ? String(config[1]) : undefined;

  if (policy && policy !== 'noeviction') {
    throw new Error(
      `Redis maxmemory-policy is "${policy}" but BullMQ requires "noeviction". ` +
        `Any other policy lets Redis silently evict job state under memory pressure, ` +
        `losing queued and in-flight jobs with no error.`,
    );
  }
}
