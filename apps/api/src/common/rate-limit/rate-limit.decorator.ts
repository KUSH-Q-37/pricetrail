import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'pricetrail:rate-limit';
export const SKIP_RATE_LIMIT_KEY = 'pricetrail:skip-rate-limit';

export interface RateLimitOptions {
  windowSeconds: number;
  maxRequests: number;
}

/**
 * Override the global rate limit for a controller or handler.
 *
 * Expensive endpoints get their own budget — ingesting a URL can trigger a
 * marketplace fetch, so it must not share a quota with cheap reads.
 *
 * @example `@RateLimit({ windowSeconds: 60, maxRequests: 10 })`
 */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

/** Exempt a route entirely — health and readiness probes must never be throttled. */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);
