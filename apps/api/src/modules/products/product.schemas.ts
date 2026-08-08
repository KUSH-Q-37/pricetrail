import { z } from 'zod';

/**
 * Request contracts for the products module.
 *
 * The URL is only length- and type-checked here. Marketplace-specific
 * validation lives in `parseMarketplaceUrl`, which produces typed failure
 * reasons the service maps to precise messages — duplicating that as a Zod
 * regex would give two sources of truth that drift apart the first time
 * Flipkart changes a path shape.
 */
export const IngestProductSchema = z.object({
  url: z.string().trim().min(10).max(2048),
});
export type IngestProductRequest = z.infer<typeof IngestProductSchema>;

export const ListProductsSchema = z.object({
  // Coerced because query strings are always strings.
  page: z.coerce.number().int().min(1).default(1),
  // Capped: an uncapped page size lets one request ask for the whole table.
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(200).optional(),
});
export type ListProductsQuery = z.infer<typeof ListProductsSchema>;

export const UpdateTrackingSchema = z.object({
  notifyBelowMinor: z.number().int().positive().max(2_000_000_000).nullable().optional(),
});
export type UpdateTrackingRequest = z.infer<typeof UpdateTrackingSchema>;
