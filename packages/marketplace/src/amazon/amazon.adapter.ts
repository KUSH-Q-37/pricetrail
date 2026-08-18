import type { ProductSearchResult } from '../search';
import {
  FetchError,
  type FetchOutcome,
  type FetchRequest,
  type FetchStrategy,
  type MarketplaceAdapter,
} from '../adapter';
import { BrowserPool, type BrowserPoolOptions } from '../browser/browser-pool';
import { HttpFetcher } from '../fetch/http-fetcher';
import { PlaywrightFetcher } from '../fetch/playwright-fetcher';
import { AmazonApiFetcher, type PaapiConfig } from './amazon.api';
import { parseAmazonProduct } from './amazon.parser';
import { AMAZON_SELECTORS } from './selectors';

export interface AmazonAdapterOptions {
  paapi?: PaapiConfig;
  browser?: BrowserPoolOptions;
  /** Disable the browser fallback (e.g. where Chromium is not installed). */
  enableBrowserFallback?: boolean;
  fetchImpl?: typeof fetch;
  onStrategyFallback?: (info: {
    from: string;
    to: string;
    reason: string;
    externalId: string;
  }) => void;
}

/**
 * Amazon adapter — walks the strategies in cost order.
 *
 *   API            free, structured, fast     (needs credentials)
 *        ↓ credentials missing / quota gone
 *   HTTP + Cheerio ~50x cheaper than a browser
 *        ↓ bot challenge or block
 *   Playwright     last resort
 *
 * Escalation is driven by the FAILURE REASON, not by blanket retrying. A 404
 * stops immediately — no strategy will conjure a deleted listing, and trying
 * all three burns three times the budget to reach the same answer. A
 * VALIDATION_FAILED also stops: the page was fetched fine and our selectors
 * could not read it, so a browser will produce the identical unparseable HTML.
 * Only challenges and blocks are worth escalating for.
 */
export class AmazonAdapter implements MarketplaceAdapter {
  readonly platform = 'AMAZON' as const;

  private readonly api: AmazonApiFetcher;
  private readonly http: HttpFetcher;
  private browserPool: BrowserPool | undefined;
  private playwright: PlaywrightFetcher | undefined;

  constructor(private readonly options: AmazonAdapterOptions = {}) {
    this.api = new AmazonApiFetcher(options.paapi);
    this.http = new HttpFetcher(parseAmazonProduct, { fetchImpl: options.fetchImpl });
  }

  /** Lazily construct the browser only if something actually escalates to it. */
  private getPlaywright(): PlaywrightFetcher | undefined {
    if (this.options.enableBrowserFallback === false) return undefined;
    if (!this.playwright) {
      this.browserPool = new BrowserPool(this.options.browser);
      this.playwright = new PlaywrightFetcher(this.browserPool, parseAmazonProduct, {
        readySelector: AMAZON_SELECTORS.title[0],
      });
    }
    return this.playwright;
  }

  /**
   * Search Amazon for candidate products, for counterpart discovery.
   *
   * PA-API only. There is deliberately no scraping fallback here: Amazon
   * blocks automated access to its search pages far more aggressively than to
   * product pages, and a blocked search would return a captcha page that
   * parses as zero results — indistinguishable from a genuine empty result,
   * and quietly wrong. Better to report the source as unavailable.
   */
  async searchProducts(query: string, limit = 5): Promise<ProductSearchResult> {
    return this.api.searchProducts(query, limit);
  }

  async fetchProduct(request: FetchRequest): Promise<FetchOutcome> {
    // An explicit strategy bypasses the ladder — used by the admin "re-fetch
    // with a browser" action and by tests.
    if (request.strategy) {
      const strategy = this.resolve(request.strategy);
      if (!strategy) {
        throw new FetchError('UNSUPPORTED', `Strategy ${request.strategy} is unavailable`);
      }
      return strategy.fetch(request);
    }

    const ladder: FetchStrategy[] = [];
    if (this.api.isAvailable()) ladder.push(this.api);
    ladder.push(this.http);

    let lastError: FetchError | undefined;

    for (const strategy of ladder) {
      try {
        return await strategy.fetch(request);
      } catch (error) {
        if (!(error instanceof FetchError)) throw error;
        lastError = error;

        if (
          error.reason === 'NOT_FOUND' ||
          error.reason === 'PARSE_FAILED' ||
          error.reason === 'VALIDATION_FAILED'
        ) {
          throw error;
        }

        this.options.onStrategyFallback?.({
          from: strategy.name,
          to: 'next',
          reason: error.reason,
          externalId: request.externalId,
        });
      }
    }

    if (lastError?.warrantsBrowser) {
      const playwright = this.getPlaywright();
      if (playwright) {
        this.options.onStrategyFallback?.({
          from: 'HTTP_CHEERIO',
          to: 'PLAYWRIGHT',
          reason: lastError.reason,
          externalId: request.externalId,
        });
        return playwright.fetch(request);
      }
    }

    throw lastError ?? new FetchError('NETWORK', 'All fetch strategies failed');
  }

  private resolve(name: FetchRequest['strategy']): FetchStrategy | undefined {
    if (name === 'API') return this.api.isAvailable() ? this.api : undefined;
    if (name === 'HTTP_CHEERIO') return this.http;
    if (name === 'PLAYWRIGHT') return this.getPlaywright();
    return undefined;
  }

  async dispose(): Promise<void> {
    await this.browserPool?.dispose();
  }
}
