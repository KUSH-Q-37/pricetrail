import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface PublicStats {
  /** Registered accounts. The landing page hides this below a floor. */
  users: number;
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

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Aggregate public counts for the marketing page' })
  @ApiOkResponse({ description: 'Cached up to five minutes.' })
  async getStats(): Promise<PublicStats> {
    if (this.cache && this.cache.expires > Date.now()) {
      return this.cache.data;
    }

    const [users, products, observations, earliest] = await Promise.all([
      this.prisma.user.count(),
      // READY only. A product still being fetched is not something to boast
      // about, and counting it would make the number jump around as the
      // pipeline runs.
      this.prisma.product.count({ where: { status: 'READY' } }),
      this.prisma.pricePoint.count(),
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

    const data: PublicStats = { users, products, observations, daysTracking };
    this.cache = { data, expires: Date.now() + StatsController.TTL_MS };
    return data;
  }
}
