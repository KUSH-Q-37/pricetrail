'use client';

import { AlertTriangle, CalendarClock, LineChart as LineChartIcon } from 'lucide-react';

import { PriceHistoryChart } from './price-history-chart';
import { PLATFORM_LABEL } from './chart-theme';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { usePriceHistory } from '@/hooks/use-price-history';
import { CHART_RANGES, useUiStore } from '@/stores/ui-store';
import { cn, formatPrice } from '@/lib/utils';

export function PriceHistoryPanel({ productId }: { productId: string }) {
  const { chartRange, setChartRange, showAmazon, showFlipkart, togglePlatform } =
    useUiStore();

  const { data, isPending, isError, error, refetch, isFetching } = usePriceHistory(
    productId,
    chartRange,
  );

  const visible = { AMAZON: showAmazon, FLIPKART: showFlipkart };
  const totalGaps =
    data?.series.reduce((sum, entry) => sum + entry.stats.missingDays, 0) ?? 0;
  const hasData = (data?.series ?? []).some((entry) => entry.stats.observedDays > 0);

  // How much history actually exists, regardless of the range selected. A
  // person who picks 15M on a product first searched last week sees a nearly
  // empty chart and reasonably assumes it is broken. Saying how much we have
  // is the difference between "no data" and "not yet".
  const observedDays = Math.max(
    0,
    ...(data?.series ?? []).map((entry) => entry.stats.observedDays),
  );

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Price history</CardTitle>

          <div className="flex items-center gap-2">
            {/* Platform toggles double as the legend's twin: each carries a
                text label, so identity never rests on colour alone. */}
            {(['AMAZON', 'FLIPKART'] as const).map((platform) => {
              const on = visible[platform];
              return (
                <button
                  key={platform}
                  onClick={() => togglePlatform(platform.toLowerCase() as 'amazon' | 'flipkart')}
                  aria-pressed={on}
                  className={cn('transition-opacity', !on && 'opacity-40')}
                >
                  <Badge variant={platform === 'AMAZON' ? 'amazon' : 'flipkart'}>
                    <span
                      className="size-1.5 rounded-full"
                      style={{
                        background:
                          platform === 'AMAZON'
                            ? 'var(--chart-amazon)'
                            : 'var(--chart-flipkart)',
                      }}
                      aria-hidden="true"
                    />
                    {PLATFORM_LABEL[platform]}
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>

        {/* One filter row, above everything it scopes. */}
        <div
          role="radiogroup"
          aria-label="Time range"
          className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1"
        >
          {CHART_RANGES.map(({ value, label, spoken }) => (
            <button
              key={value}
              role="radio"
              aria-checked={chartRange === value}
              // The visible text is an abbreviation; the accessible name is the
              // expanded form. Without this a screen reader announces "seven
              // dee" and voice control has nothing sayable to target.
              aria-label={spoken}
              onClick={() => setChartRange(value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium tabular-price transition-colors duration-200',
                chartRange === value
                  ? 'bg-card text-foreground shadow-[var(--shadow-xs)]'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isPending ? (
          <div aria-busy="true">
            <span className="sr-only">Loading price history…</span>
            <Skeleton className="h-[340px] rounded-lg" />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !hasData ? (
          <EmptyState
            icon={LineChartIcon}
            title="No price history yet"
            description="Prices appear here once the daily tracker records its first observation for this product."
            className="border-0 bg-muted/20 py-14"
          />
        ) : (
          <>
            {/* Selective direct labels: current price per platform, beside a
                swatch. Never a number on every point. */}
            <div className="flex flex-wrap gap-4">
              {data.series
                .filter((entry) => visible[entry.platform])
                .map((entry) => (
                  <div key={entry.platform} className="min-w-[130px]">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-sm"
                        style={{
                          background:
                            entry.platform === 'AMAZON'
                              ? 'var(--chart-amazon)'
                              : 'var(--chart-flipkart)',
                        }}
                        aria-hidden="true"
                      />
                      <span className="text-xs text-muted-foreground">
                        {PLATFORM_LABEL[entry.platform]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xl font-semibold tabular-price">
                      {entry.stats.latest !== null
                        ? formatPrice(entry.stats.latest, entry.currency)
                        : '—'}
                    </p>
                    {entry.stats.changePercent !== null ? (
                      // Price movement, not system status — hence the
                      // price-down / price-up tokens rather than success and
                      // destructive. A rise used to render muted grey, which
                      // threw away half the information: a shopper needs to see
                      // that a price went UP as clearly as that it fell.
                      //
                      // The arrow and the sign both carry it too, so the meaning
                      // survives for a colourblind reader.
                      <p
                        className={cn(
                          'mt-0.5 inline-flex items-center gap-1 text-xs tabular-price',
                          entry.stats.changePercent < 0
                            ? 'text-price-down'
                            : entry.stats.changePercent > 0
                              ? 'text-price-up'
                              : 'text-price-flat',
                        )}
                      >
                        {entry.stats.changePercent !== 0 ? (
                          <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                            <path
                              d={
                                entry.stats.changePercent < 0
                                  ? 'M6 2 v6 M3 6.5 L6 9.5 L9 6.5'
                                  : 'M6 10 V4 M3 5.5 L6 2.5 L9 5.5'
                              }
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                        {entry.stats.changePercent > 0 ? '+' : ''}
                        {entry.stats.changePercent}% over {chartRange}
                      </p>
                    ) : null}
                  </div>
                ))}
            </div>

            <PriceHistoryChart
              series={data.series}
              visible={visible}
              loading={isFetching}
            />

            {/* Gaps are stated, not hidden. A break in the line is a fact
                about our data collection, and the reader is told so. */}
            {totalGaps > 0 ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {totalGaps} day{totalGaps === 1 ? '' : 's'} with no recorded
                  observation in this range. Breaks in the line are real gaps —
                  we do not estimate prices we did not observe.
                </span>
              </p>
            ) : null}

            {observedDays > 0 && observedDays < 30 ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {observedDays} day{observedDays === 1 ? '' : 's'} of history so
                  far. Neither marketplace publishes past prices, so this chart
                  grows one observation per day from the moment you added the
                  product — longer ranges fill in over time.
                </span>
              </p>
            ) : null}

            {data.downsampled ? (
              <p className="text-xs text-muted-foreground">
                Long range: points reduced for rendering, preserving peaks and troughs.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
