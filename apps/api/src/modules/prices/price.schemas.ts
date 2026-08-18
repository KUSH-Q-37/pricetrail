import { z } from 'zod';

/**
 * The six ranges the product offers, and how many days each spans.
 *
 * The longest is 15 months, which is not arbitrary: retention drops
 * price_points partitions older than PRICE_HISTORY_RETENTION_MONTHS (15).
 * Offering a longer range than the data is kept for would render a window
 * that is guaranteed to be partly empty, for a reason invisible to the user.
 * These two numbers must move together.
 */
export const RANGE_DAYS = {
  '7D': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '15M': 457,
} as const;

export type ChartRange = keyof typeof RANGE_DAYS;

export const HistoryQuerySchema = z.object({
  range: z.enum(['7D', '1M', '3M', '6M', '1Y', '15M']).default('3M'),
  /** Comma-separated platform filter. Empty means both. */
  platforms: z.string().optional(),
});

export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
