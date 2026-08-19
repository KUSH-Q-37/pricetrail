'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface ApiMeta {
  apiVersion: string;
  environment: string;
  timezone: string;
  serverTime: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  dependencies: Record<
    string,
    { status: 'up' | 'down'; latencyMs?: number; error?: string }
  >;
}

/**
 * Query keys live in one place so invalidation never depends on two call sites
 * spelling the same array identically.
 */
export const queryKeys = {
  meta: ['meta'] as const,
  health: ['health'] as const,
  stats: ['stats'] as const,
  products: {
    all: ['products'] as const,
    detail: (id: string) => ['products', id] as const,
    history: (id: string, range: string) =>
      ['products', id, 'history', range] as const,
  },
} as const;

export function useApiMeta() {
  return useQuery({
    queryKey: queryKeys.meta,
    queryFn: () => apiClient.get<ApiMeta>('/api/v1/meta'),
    // Version and timezone effectively never change within a session.
    staleTime: 60 * 60 * 1000,
  });
}

export interface PublicStats {
  products: number;
  observations: number;
  daysTracking: number;
}

/**
 * Aggregate counts, for the stat row.
 *
 * The dashboard used to read these from the products LIST endpoint — fetching
 * six full product rows, with their listings, in order to display one integer.
 * This asks for the integer. The API caches it for five minutes, and unlike
 * the list it returns nothing about any individual product, so the summary
 * cannot leak what anyone searched.
 */
export function usePublicStats() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => apiClient.get<PublicStats>('/api/v1/stats'),
    // Matches the API's own cache; asking more often only costs round trips.
    staleTime: 5 * 60 * 1000,
  });
}

export function useApiHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => apiClient.get<HealthReport>('/health/ready'),
    refetchInterval: 30_000,
    staleTime: 15_000,
    // A degraded dependency returns 503. That is a meaningful answer to
    // display, not a failure to retry into.
    retry: false,
  });
}
