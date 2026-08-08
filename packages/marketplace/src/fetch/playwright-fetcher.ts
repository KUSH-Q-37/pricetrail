import {
  FetchError,
  type FetchOutcome,
  type FetchRequest,
  type FetchStrategy,
} from '../adapter';
import type { BrowserPool } from '../browser/browser-pool';
import { finishFetch } from './http-fetcher';
import type { ParseFunction } from './parse-function';

export interface PlaywrightFetcherOptions {
  /** Selector to wait for before reading content, e.g. the product title. */
  readySelector?: string;
  readyTimeoutMs?: number;
}

/**
 * Headless-browser fallback. Platform-agnostic.
 *
 * Reached only when the HTTP strategy hits a challenge or a block — it costs
 * roughly 50x more per fetch. Note that once the HTML is in hand this calls
 * the SAME ParseFunction as the HTTP path via `finishFetch`: one parsing
 * implementation, one set of selectors, one set of fixtures covering both.
 * A separate browser-specific parser would double the surface that the next
 * layout change breaks.
 */
export class PlaywrightFetcher implements FetchStrategy {
  readonly name = 'PLAYWRIGHT' as const;

  constructor(
    private readonly pool: BrowserPool,
    private readonly parse: ParseFunction,
    private readonly options: PlaywrightFetcherOptions = {},
  ) {}

  isAvailable(): boolean {
    return true;
  }

  async fetch(request: FetchRequest): Promise<FetchOutcome> {
    const started = Date.now();

    return this.pool.withPage(async (page) => {
      let status: number | undefined;

      try {
        const response = await page.goto(request.url, {
          // 'domcontentloaded', not 'networkidle': both marketplaces hold
          // long-lived analytics and ad connections open, so networkidle
          // frequently never fires and every fetch burns the full timeout.
          waitUntil: 'domcontentloaded',
          timeout: request.timeoutMs ?? 30_000,
        });
        status = response?.status();

        if (status && status >= 400) {
          throw new FetchError(
            status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : 'BLOCKED',
            `HTTP ${status}`,
            { httpStatus: status },
          );
        }

        // Wait for real content rather than a fixed sleep: a sleep is either
        // too short (flaky) or too long (slow) on every single fetch.
        if (this.options.readySelector) {
          await page
            .waitForSelector(this.options.readySelector, {
              timeout: this.options.readyTimeoutMs ?? 8_000,
            })
            .catch(() => undefined);
        }
      } catch (error) {
        if (error instanceof FetchError) throw error;
        const timedOut = error instanceof Error && /timeout/i.test(error.message);
        throw new FetchError(timedOut ? 'TIMEOUT' : 'NETWORK', 'Navigation failed', {
          cause: error,
        });
      }

      const html = await page.content();

      return finishFetch({
        html,
        request,
        parse: this.parse,
        strategy: this.name,
        startedAt: started,
        httpStatus: status,
      });
    });
  }
}
