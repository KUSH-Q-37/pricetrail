import {
  Controller,
  Get,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { SkipRateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { isWorkerUnhealthy, workerStatus } from '../../infra/worker/worker-status';

type DependencyState = 'up' | 'down';

interface ReadinessReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  dependencies: Record<string, { status: DependencyState; latencyMs?: number; error?: string }>;
  /** Co-hosted queue consumers. See infra/worker/worker-status.ts. */
  workers: { state: string; attempts: number; lastError?: string; runningSince?: string };
  /** Freshness of the data this product exists to collect. */
  observations: {
    newestCapturedOn: string | null;
    ageHours: number | null;
    stale: boolean;
  };
}

/**
 * How old the newest observation may be before readiness fails.
 *
 * The sweep runs daily, so 24 hours is the expected maximum. 26 gives the
 * sweep window and a slow scrape room to finish without flapping, while still
 * catching a missed day the morning after rather than three days later.
 */
const MAX_OBSERVATION_AGE_HOURS = 26;

/**
 * Liveness and readiness, split deliberately.
 *
 * This is hand-rolled rather than using @nestjs/terminus. Terminus adds a
 * dependency and an indicator abstraction to express what is, here, two
 * `SELECT 1`-class calls — and its indicator API changed shape between major
 * versions. Sixty lines we control beat a dependency we would have to track.
 *
 * The distinction matters to any orchestrator:
 *
 *   /health/live   Is the process alive? Never touches a dependency.
 *                  A failure here means RESTART ME.
 *
 *   /health/ready  Can it serve traffic? Checks Postgres and Redis.
 *                  A failure here means STOP SENDING TRAFFIC — but do not
 *                  restart, because a restart will not fix a downed database
 *                  and a restart loop makes the outage worse.
 *
 * Conflating them is how a brief database blip turns into every API replica
 * crash-looping simultaneously.
 */
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  @SkipRateLimit()
  @ApiOperation({ summary: 'Liveness probe — process is running' })
  @ApiResponse({ status: 200, description: 'Process is alive' })
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: this.uptimeSeconds() };
  }

  @Get('ready')
  @SkipRateLimit()
  @ApiOperation({ summary: 'Readiness probe — dependencies reachable' })
  @ApiResponse({ status: 200, description: 'All dependencies healthy' })
  @ApiResponse({ status: 503, description: 'One or more dependencies are down' })
  async ready(): Promise<ReadinessReport> {
    const [database, redis, observations] = await Promise.all([
      this.check(() => this.prisma.ping()),
      this.check(() => this.redis.ping()),
      this.observationFreshness(),
    ]);

    // Reachable dependencies are necessary but not sufficient.
    //
    // For three days in Aug 2026 this endpoint returned "ok" while nothing was
    // consuming the queue: Postgres and Redis were both up, so by the only
    // question it asked, everything was fine. The product was silently not
    // doing the one thing it exists to do. A readiness check that cannot fail
    // for the most likely failure is decoration.
    const healthy =
      database.status === 'up' &&
      redis.status === 'up' &&
      !isWorkerUnhealthy() &&
      !observations.stale;

    const report: ReadinessReport = {
      status: healthy ? 'ok' : 'degraded',
      uptimeSeconds: this.uptimeSeconds(),
      dependencies: { database, redis },
      workers: { ...workerStatus },
      observations,
    };

    if (report.status !== 'ok') {
      // Thrown so the status code is 503; the filter renders the envelope and
      // the report travels in the log line.
      throw new ServiceUnavailableException(report);
    }

    return report;
  }

  /**
   * Age of the most recent price observation.
   *
   * Never stale when no observations exist at all — a fresh deployment with no
   * tracked products has nothing to be late about, and failing there would
   * make the check cry wolf before the system has been asked to do anything.
   */
  private async observationFreshness(): Promise<ReadinessReport['observations']> {
    try {
      const newest = await this.prisma.pricePoint.findFirst({
        // lastConfirmedOn, not capturedOn. Rows are change intervals: a price
        // set three weeks ago and confirmed again this morning has an old
        // captured_on, and ordering by it would report the tracker as three
        // weeks stale while it was in fact working perfectly.
        orderBy: { lastConfirmedOn: 'desc' },
        select: { lastConfirmedOn: true },
      });

      if (!newest) {
        return { newestCapturedOn: null, ageHours: null, stale: false };
      }

      const ageHours = Math.floor(
        (Date.now() - newest.lastConfirmedOn.getTime()) / (1000 * 60 * 60),
      );

      return {
        newestCapturedOn: newest.lastConfirmedOn.toISOString(),
        ageHours,
        stale: ageHours > MAX_OBSERVATION_AGE_HOURS,
      };
    } catch {
      // The database probe above already reports connectivity; do not fail
      // twice for one cause.
      return { newestCapturedOn: null, ageHours: null, stale: false };
    }
  }

  private async check(
    probe: () => Promise<void>,
  ): Promise<{ status: DependencyState; latencyMs?: number; error?: string }> {
    const started = Date.now();
    try {
      await probe();
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : 'unknown error',
      };
    }
  }

  private uptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }
}
