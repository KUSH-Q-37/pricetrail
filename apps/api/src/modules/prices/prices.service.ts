import { Injectable } from '@nestjs/common';
import type { Platform } from '@pricetrail/database';

import { NotFoundError } from '../../common/errors/app-error';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.service';
import { downsampleWithGaps, type SeriesPoint } from './downsample';
import { RANGE_DAYS, type ChartRange } from './price.schemas';

/** Points per series sent to the client. Above this, LTTB reduces. */
const MAX_POINTS_PER_SERIES = 400;

export interface HistorySeries {
  platform: Platform;
  listingId: string;
  currency: string;
  /** [epochMs, priceMinor | null]. null marks a day with no observation. */
  points: Array<[number, number | null]>;
  stats: {
    min: number | null;
    max: number | null;
    latest: number | null;
    first: number | null;
    changePercent: number | null;
    observedDays: number;
    missingDays: number;
  };
}

export interface HistoryResponse {
  productId: string;
  range: ChartRange;
  from: string;
  to: string;
  downsampled: boolean;
  series: HistorySeries[];
}

@Injectable()
export class PricesService {
  constructor(private readonly prisma: PrismaService) {}

  async getHistory(
    user: AuthenticatedUser,
    productId: string,
    range: ChartRange,
    platformFilter?: string,
  ): Promise<HistoryResponse> {
    // Ownership enforced in the query, never post-hoc. Same rule as Phase 6.
    const product = await this.prisma.product.findFirst({
      where: { id: productId, trackedBy: { some: { userId: user.id } } },
      select: { id: true, listings: { select: { id: true, platform: true, currency: true } } },
    });
    if (!product) throw new NotFoundError('Product', productId);

    const days = RANGE_DAYS[range];

    // Bounded on BOTH ends. Phase 2 §8.6: `captured_on >= $from` prunes only
    // past partitions, leaving every future one in the plan. BETWEEN prunes
    // both ends — this is the difference between scanning 2 partitions and 31.
    const to = startOfUtcDay(new Date());
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - (days - 1));

    const wanted = new Set(
      (platformFilter ?? '')
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean),
    );

    const listings = product.listings.filter(
      (listing) => wanted.size === 0 || wanted.has(listing.platform),
    );

    let downsampled = false;

    const series = await Promise.all(
      listings.map(async (listing) => {
        const rows = await this.prisma.pricePoint.findMany({
          where: { listingId: listing.id, capturedOn: { gte: from, lte: to } },
          select: { capturedOn: true, priceMinor: true },
          orderBy: { capturedOn: 'asc' },
        });

        const dense = this.toDenseDailySeries(rows, from, days);

        const observedDays = dense.filter((point) => point.value !== null).length;
        const values = dense
          .map((point) => point.value)
          .filter((value): value is number => value !== null);

        const reduced =
          dense.length > MAX_POINTS_PER_SERIES
            ? downsampleWithGaps(dense, MAX_POINTS_PER_SERIES)
            : dense;
        if (reduced.length < dense.length) downsampled = true;

        const first = values[0] ?? null;
        const latest = values[values.length - 1] ?? null;

        return {
          platform: listing.platform,
          listingId: listing.id,
          currency: listing.currency,
          points: reduced.map((point) => [point.t, point.value] as [number, number | null]),
          stats: {
            min: values.length > 0 ? Math.min(...values) : null,
            max: values.length > 0 ? Math.max(...values) : null,
            latest,
            first,
            changePercent:
              first !== null && latest !== null && first > 0
                ? Math.round(((latest - first) / first) * 1000) / 10
                : null,
            observedDays,
            missingDays: dense.length - observedDays,
          },
        } satisfies HistorySeries;
      }),
    );

    return {
      productId,
      range,
      from: from.toISOString(),
      to: to.toISOString(),
      downsampled,
      series,
    };
  }

  /**
   * Expand sparse observations into one slot per day, with null where nothing
   * was recorded.
   *
   * THIS IS THE HONESTY MECHANISM. price_points holds a row only for days a
   * fetch succeeded. Sending just those rows to a time-axis chart draws a
   * straight line across a two-week outage — inventing a smooth price history
   * for a period we know nothing about. Emitting explicit nulls lets the
   * renderer break the line, so a gap looks like a gap.
   */
  private toDenseDailySeries(
    rows: Array<{ capturedOn: Date; priceMinor: number }>,
    from: Date,
    days: number,
  ): SeriesPoint[] {
    const byDay = new Map<number, number>();
    for (const row of rows) {
      byDay.set(startOfUtcDay(row.capturedOn).getTime(), row.priceMinor);
    }

    const dense: SeriesPoint[] = [];
    for (let offset = 0; offset < days; offset++) {
      const day = new Date(from);
      day.setUTCDate(day.getUTCDate() + offset);
      const t = day.getTime();
      dense.push({ t, value: byDay.get(t) ?? null });
    }

    // Trim leading nulls: a product tracked for a week should not render as
    // 17 months of emptiness followed by a stub of data.
    const firstObserved = dense.findIndex((point) => point.value !== null);
    return firstObserved <= 0 ? dense : dense.slice(firstObserved);
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
