import { QueryClient, type DefaultOptions } from '@tanstack/react-query';

import { ApiError } from './api-client';

/**
 * Query defaults tuned to this domain.
 *
 * Prices are captured once per day. Treating that data as volatile — the
 * library default of `staleTime: 0` — would refetch a full price history on
 * every mount and remount for data that provably cannot have changed.
 */
const defaultOptions: DefaultOptions = {
  queries: {
    // Chart and listing data is refreshed by the daily worker, not by user
    // activity. Five minutes is already far more aggressive than reality.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,

    // Retrying a 404 or a 422 just produces the same answer three times more
    // slowly, and retrying a 429 actively deepens the rate limit.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isClientFault) return false;
      return failureCount < 2;
    },

    retryDelay: (attemptIndex) =>
      Math.min(1000 * 2 ** attemptIndex, 15_000),

    // Tab focus is not a signal that a daily price changed. Left on, every
    // alt-tab would fire a refetch storm across every mounted chart.
    refetchOnWindowFocus: false,

    // Reconnecting genuinely can mean stale data, so this one stays on.
    refetchOnReconnect: true,
  },
  mutations: {
    retry: false,
  },
};

/**
 * A fresh client per request on the server, a single cached client in the
 * browser.
 *
 * A module-level singleton would be shared across concurrent SSR renders,
 * meaning one user's cached data could be serialized into another user's HTML.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
