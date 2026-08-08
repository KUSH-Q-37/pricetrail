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
import { Public } from '../auth/decorators';

type DependencyState = 'up' | 'down';

interface ReadinessReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  dependencies: Record<string, { status: DependencyState; latencyMs?: number; error?: string }>;
}

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
// An orchestrator's probe carries no credentials. Requiring auth here would
// make every replica fail its readiness check and never receive traffic.
@Public()
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
    const [database, redis] = await Promise.all([
      this.check(() => this.prisma.ping()),
      this.check(() => this.redis.ping()),
    ]);

    const report: ReadinessReport = {
      status: database.status === 'up' && redis.status === 'up' ? 'ok' : 'degraded',
      uptimeSeconds: this.uptimeSeconds(),
      dependencies: { database, redis },
    };

    if (report.status !== 'ok') {
      // Thrown so the status code is 503; the filter renders the envelope and
      // the report travels in the log line.
      throw new ServiceUnavailableException(report);
    }

    return report;
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
