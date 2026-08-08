'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { ChartRange } from '@/stores/ui-store';

export interface HistorySeries {
  platform: 'AMAZON' | 'FLIPKART';
  listingId: string;
  currency: string;
  /** [epochMs, priceMinor | null] — null marks a day with no observation. */
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

export function usePriceHistory(productId: string, range: ChartRange) {
  return useQuery({
    queryKey: ['products', productId, 'history', range],
    queryFn: () =>
      apiClient.get<HistoryResponse>(
        `/api/v1/products/${productId}/history?range=${range}`,
      ),
    // Prices are captured once a day; a 5-minute stale window is already far
    // more aggressive than the data can change.
    staleTime: 5 * 60 * 1000,
    // Switching range must NOT blank the chart. Holding the previous render
    // while the next range loads avoids a skeleton flash and a layout jump on
    // every click — the chart just dims and swaps.
    placeholderData: keepPreviousData,
  });
}
