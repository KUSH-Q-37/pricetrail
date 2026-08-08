'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/hooks/use-api-status';

export type Platform = 'AMAZON' | 'FLIPKART';
export type ProductStatus = 'PENDING' | 'READY' | 'FAILED' | 'ARCHIVED';

export interface Listing {
  id: string;
  platform: Platform;
  externalId: string;
  url: string;
  title: string;
  currency: string;
  currentPriceMinor: number | null;
  mrpMinor: number | null;
  discountPercent: number | null;
  availability: string;
  rating: string | null;
  reviewCount: number | null;
  sellerName: string | null;
  trackingEnabled: boolean;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

export interface Product {
  id: string;
  status: ProductStatus;
  category: string;
  brand: string | null;
  title: string;
  imageUrl: string | null;
  createdAt: string;
  listings: Listing[];
  tracking: { notifyBelowMinor: number | null; createdAt: string } | null;
}

interface ProductPage {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export function useProducts(page = 1, pageSize = 20): UseQueryResult<ProductPage> {
  return useQuery({
    queryKey: [...queryKeys.products.all, { page, pageSize }],
    queryFn: () =>
      apiClient.get<ProductPage>(
        `/api/v1/products?page=${page}&pageSize=${pageSize}`,
      ),
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: () => apiClient.get<Product>(`/api/v1/products/${id}`),
    // A freshly ingested product is PENDING until a fetcher fills it in.
    // Poll while that is true, and stop as soon as it is not — an unconditional
    // interval would poll every settled product forever.
    refetchInterval: (query) =>
      query.state.data?.status === 'PENDING' ? 5_000 : false,
  });
}

export function useIngestProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (url: string) =>
      apiClient.post<Product>('/api/v1/products/ingest', { url }),
    onSuccess: (product) => {
      // Invalidate rather than hand-patch the list: the server may have
      // returned an existing product rather than a new one, so appending
      // blindly would show a duplicate row.
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      queryClient.setQueryData(queryKeys.products.detail(product.id), product);
    },
  });
}

export function useUntrackProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/products/${id}`),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.products.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}
