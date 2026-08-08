import { z } from 'zod';

/** The six ranges the product offers, and how many days each spans. */
export const RANGE_DAYS = {
  '7D': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '18M': 548,
} as const;

export type ChartRange = keyof typeof RANGE_DAYS;

export const HistoryQuerySchema = z.object({
  range: z.enum(['7D', '1M', '3M', '6M', '1Y', '18M']).default('3M'),
  /** Comma-separated platform filter. Empty means both. */
  platforms: z.string().optional(),
});

export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
