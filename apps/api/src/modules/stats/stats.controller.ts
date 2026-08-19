import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../infra/prisma/prisma.service';

export interface PublicStats {
  /** Products with at least one successfully fetched listing. */
  products: number;
  /** Individual daily price observations recorded, ever. */
  observations: number;
  /** Days since the first observation — 0 before any exist. */
  daysTracking: number;
}

@ApiTags('stats')
@Controller({ path: 'stats', version: '1' })
export class StatsController {
  /**
   * Counts are cached in memory for five minutes.
   *
   * This route is public and uncredentialed, so it is the cheapest thing on the
   * API to hit in a loop. Without a cache, four COUNT(*) queries per request
   * would let anyone exhaust a free Postgres tier's connections from a laptop.
   * Five minutes is far fresher than the numbers need to be — they change once
   * a day.
   */
  private cache: { data: PublicStats; expires: number } | null = null;
  private static readonly TTL_MS = 5 * 60 * 1000;

  /**
   * Below this many observations, count exactly.
   *
   * COUNT(*) on price_points is an Append with a sequential scan of EVERY
   * monthly partition — its cost grows with the whole history and never comes
   * back down, and this endpoint is public and refreshed on a timer. Above the
   * threshold the planner's own statistics answer in constant time and land
   * within about 1%, which nobody reading "prices recorded" can perceive.
   *
   * Below it, an exact count is a few milliseconds and the difference between
   * 1,628 and 1,642 IS visible on a small site. So: precise while precision is
   * cheap, estimated once it stops being.
   */
  private static readonly EXACT_COUNT_LIMIT = 200_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Row estimate for price_points, in constant time.
   *
   * reltuples on the partitioned parent is 0 — the rows live in the children,
   * so the estimate has to be summed across them via pg_inherits.
   */
  private async estimateObservations(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ estimate: bigint }>>`
      SELECT COALESCE(SUM(child.reltuples), 0)::bigint AS estimate
      FROM pg_class child
      JOIN pg_inherits inh ON inh.inhrelid = child.oid
      JOIN pg_class parent ON parent.oid = inh.inhparent
      WHERE parent.relname = 'price_points'
    `;
    return Number(rows[0]?.estimate ?? 0);
  }

  @Get()
  @ApiOperation({ summary: 'Aggregate public counts for the marketing page' })
  @ApiOkResponse({ description: 'Cached up to five minutes.' })
  async getStats(): Promise<PublicStats> {
    if (this.cache && this.cache.expires > Date.now()) {
      return this.cache.data;
    }

    const [products, estimate, earliest] = await Promise.all([
      // READY only. A product still being fetched is not something to boast
      // about, and counting it would make the number jump around as the
      // pipeline runs.
      this.prisma.product.count({ where: { status: 'READY' } }),
      this.estimateObservations(),
      this.prisma.pricePoint.findFirst({
        orderBy: { capturedOn: 'asc' },
        select: { capturedOn: true },
      }),
    ]);

    const daysTracking = earliest
      ? Math.max(
          1,
          Math.ceil(
            (Date.now() - earliest.capturedOn.getTime()) / (1000 * 60 * 60 * 24),
          ),
        )
      : 0;

    const observations =
      estimate < StatsController.EXACT_COUNT_LIMIT
        ? await this.prisma.pricePoint.count()
        : estimate;

    const data: PublicStats = { products, observations, daysTracking };
    this.cache = { data, expires: Date.now() + StatsController.TTL_MS };
    return data;
  }
}
