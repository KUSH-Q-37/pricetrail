import type { FetchedProduct } from './product-data.schema';

/**
 * Why a fetch failed. The distinction drives retry policy, so a wrong
 * classification is expensive in both directions: retrying a NOT_FOUND wastes
 * budget on a page that will never exist, while giving up on a RATE_LIMITED
 * abandons a product that would have succeeded in ten minutes.
 */
export type FetchErrorReason =
  | 'NOT_FOUND' // 404 — the listing is gone. Do not retry.
  | 'BOT_CHALLENGE' // captcha. Retry with a browser and a fresh proxy.
  | 'RATE_LIMITED' // 429/503. Back off hard.
  | 'BLOCKED' // 403. Proxy or fingerprint is burned.
  | 'TIMEOUT'
  | 'NETWORK'
  | 'PARSE_FAILED' // page fetched, selectors did not match. Alert a human.
  | 'VALIDATION_FAILED' // parsed, but the data is not trustworthy.
  | 'API_ERROR'
  | 'QUOTA_EXHAUSTED' // API quota gone. Fall back to scraping.
  | 'UNSUPPORTED';

export class FetchError extends Error {
  readonly reason: FetchErrorReason;
  readonly httpStatus?: number;
  readonly issues?: Array<{ path: string; message: string }>;

  constructor(
    reason: FetchErrorReason,
    message: string,
    options: {
      httpStatus?: number;
      issues?: Array<{ path: string; message: string }>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'FetchError';
    this.reason = reason;
    this.httpStatus = options.httpStatus;
    this.issues = options.issues;
  }

  /**
   * Whether retrying could plausibly succeed.
   *
   * PARSE_FAILED and VALIDATION_FAILED are deliberately NOT retryable: the
   * page came back fine and our code could not read it, so hammering the same
   * URL three more times produces three more identical failures and burns
   * crawl budget. Those need a human to look at the selectors.
   */
  get isRetryable(): boolean {
    return (
      this.reason === 'BOT_CHALLENGE' ||
      this.reason === 'RATE_LIMITED' ||
      this.reason === 'BLOCKED' ||
      this.reason === 'TIMEOUT' ||
      this.reason === 'NETWORK'
    );
  }

  /** Whether escalating from plain HTTP to a real browser might help. */
  get warrantsBrowser(): boolean {
    return this.reason === 'BOT_CHALLENGE' || this.reason === 'BLOCKED';
  }
}

export type FetchStrategyName = 'API' | 'HTTP_CHEERIO' | 'PLAYWRIGHT';

export interface FetchRequest {
  externalId: string;
  url: string;
  /** Force a specific strategy. Omit to let the adapter choose. */
  strategy?: FetchStrategyName;
  timeoutMs?: number;
}

export interface FetchOutcome {
  product: FetchedProduct;
  strategy: FetchStrategyName;
  durationMs: number;
  httpStatus?: number;
}

/**
 * One fetch strategy — an API client, an HTTP+Cheerio fetcher, or a headless
 * browser. Strategies are ordered by cost, and the adapter walks them.
 */
export interface FetchStrategy {
  readonly name: FetchStrategyName;
  /** False when unconfigured (no API credentials, no browser installed). */
  isAvailable(): boolean;
  fetch(request: FetchRequest): Promise<FetchOutcome>;
  dispose?(): Promise<void>;
}

/**
 * A marketplace, independent of how its data is obtained.
 *
 * This interface is the reason the Phase 1 decision to go API-first was a
 * configuration change rather than a rewrite. Callers — the ingest service,
 * the daily worker, the matching pipeline — never learn whether a price came
 * from the Creators API or from a headless browser. If Amazon revokes API access
 * tomorrow, the scraping strategy is already the full implementation and gets
 * promoted; nothing above this line changes.
 */
export interface MarketplaceAdapter {
  readonly platform: 'AMAZON' | 'FLIPKART';
  fetchProduct(request: FetchRequest): Promise<FetchOutcome>;
  dispose(): Promise<void>;
}
