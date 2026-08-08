'use client';

import { PLATFORM_LABEL } from './chart-theme';
import type { HistorySeries } from '@/hooks/use-price-history';
import { formatPrice } from '@/lib/utils';

/**
 * The table twin of the chart.
 *
 * Not an optional extra. Two rules make it mandatory: a tooltip must never be
 * the ONLY way to read a value, and the light-mode Amazon fill sits close to
 * the mark-contrast floor, which obligates a relief channel. This table is
 * that channel — and it is the WCAG-clean equivalent for anyone who cannot use
 * a hover-driven canvas at all.
 *
 * It shows the most recent observations, newest first, with missing days
 * stated explicitly rather than omitted.
 */
export function PriceTableView({
  series,
  limit = 30,
}: {
  series: HistorySeries[];
  limit?: number;
}) {
  // Union of every timestamp across series, so a day observed on only one
  // marketplace still gets a row.
  const timestamps = [
    ...new Set(series.flatMap((entry) => entry.points.map(([t]) => t))),
  ]
    .sort((a, b) => b - a)
    .slice(0, limit);

  const lookup = new Map<string, number | null>();
  for (const entry of series) {
    for (const [t, value] of entry.points) {
      lookup.set(`${entry.platform}:${t}`, value);
    }
  }

  if (timestamps.length === 0) {
    return <p className="text-sm text-muted-foreground">No observations recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Daily recorded prices per marketplace, newest first. Days with no
          recorded observation are marked.
        </caption>
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="py-2 pr-4 font-medium text-muted-foreground">
              Date
            </th>
            {series.map((entry) => (
              <th
                key={entry.platform}
                scope="col"
                className="py-2 pr-4 text-right font-medium text-muted-foreground"
              >
                {PLATFORM_LABEL[entry.platform]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {timestamps.map((t) => (
            <tr key={t} className="border-b border-border/50 last:border-0">
              <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                {new Date(t).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </th>
              {series.map((entry) => {
                const value = lookup.get(`${entry.platform}:${t}`);
                return (
                  <td
                    key={entry.platform}
                    className="py-1.5 pr-4 text-right tabular-price"
                  >
                    {value === null || value === undefined ? (
                      <span className="text-muted-foreground">not recorded</span>
                    ) : (
                      formatPrice(value, entry.currency)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
