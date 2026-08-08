import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';

import { QUEUE, type JobPayloads, type QueueName } from './queues';

/**
 * Retry policy.
 *
 * Exponential from 60s: roughly 1min, 2min, 4min. Phase 1 sketched
 * 1/5/30 minutes; exponential backoff with `attempts: 4` lands in the same
 * territory while letting BullMQ compute it, and adds jitter-free
 * predictability for the audit trail.
 *
 * `removeOnComplete` keeps the last 1000 for debugging but bounds growth —
 * Redis is memory, and an unbounded completed set is how a queue server runs
 * out of it. Failures are kept far longer because they are what you actually
 * need to read.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600, count: 5_000 },
};

export class QueueProducer {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly connection: Redis) {}

  private get(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /**
   * Enqueue a job.
   *
   * `jobId` is how callers make an enqueue idempotent: BullMQ refuses to add a
   * second job with an id already present, so re-ingesting the same URL twice
   * does not queue two fetches of the same page.
   */
  async enqueue<T extends QueueName>(
    name: T,
    payload: JobPayloads[T],
    options: JobsOptions = {},
  ): Promise<string | undefined> {
    const job = await this.get(name).add(name, payload, options);
    return job.id;
  }

  /**
   * Enqueue many jobs in one round trip.
   *
   * The daily sweep enqueues thousands at once; `addBulk` is a single pipeline
   * rather than N round trips, which is the difference between seconds and
   * minutes just to fan out.
   */
  async enqueueBulk<T extends QueueName>(
    name: T,
    entries: Array<{ payload: JobPayloads[T]; options?: JobsOptions }>,
  ): Promise<number> {
    if (entries.length === 0) return 0;
    const jobs = await this.get(name).addBulk(
      entries.map((entry) => ({
        name,
        data: entry.payload,
        opts: entry.options,
      })),
    );
    return jobs.length;
  }

  /**
   * Register a cron-scheduled job.
   *
   * BullMQ repeatable jobs — NOT node-cron. Phase 1 flagged this: node-cron
   * inside a replicated process fires once per replica, so a daily sweep on
   * three replicas runs three times and triples the fetch budget. BullMQ
   * stores the schedule in Redis keyed by name+pattern, so registering it from
   * every replica on boot is idempotent and it fires exactly once
   * cluster-wide.
   */
  async schedule(
    name: QueueName,
    payload: JobPayloads[QueueName],
    options: { pattern: string; jobId: string; tz?: string },
  ): Promise<void> {
    await this.get(name).add(name, payload, {
      repeat: { pattern: options.pattern, tz: options.tz ?? 'Asia/Kolkata' },
      jobId: options.jobId,
    });
  }

  /** Remove a repeatable schedule whose pattern has changed. */
  async unschedule(name: QueueName, pattern: string, tz = 'Asia/Kolkata'): Promise<void> {
    const repeatables = await this.get(name).getRepeatableJobs();
    for (const repeatable of repeatables) {
      if (repeatable.pattern === pattern || repeatable.tz !== tz) {
        await this.get(name).removeRepeatableByKey(repeatable.key);
      }
    }
  }

  async counts(name: QueueName): Promise<Record<string, number>> {
    return this.get(name).getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
  }

  get allQueueNames(): QueueName[] {
    return Object.values(QUEUE);
  }
}
