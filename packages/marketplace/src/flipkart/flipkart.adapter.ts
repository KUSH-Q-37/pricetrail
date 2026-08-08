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
import { FlipkartAffiliateFetcher, type FlipkartAffiliateConfig } from './flipkart.api';
import { parseFlipkartProduct } from './flipkart.parser';
import { FLIPKART_SELECTORS } from './selectors';

export interface FlipkartAdapterOptions {
  affiliate?: FlipkartAffiliateConfig;
  browser?: BrowserPoolOptions;
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
 * Flipkart adapter — identical escalation contract to Amazon's.
 *
 * The ladder and its stopping rules are the same by design: callers switch
 * marketplaces without learning a second failure model, and the daily worker
 * treats both platforms uniformly.
 *
 * One notable difference in practice: Flipkart's HTTP path succeeds more often
 * than Amazon's, because the JSON-LD block is present in the server-rendered
 * HTML and does not require JavaScript execution to read.
 */
export class FlipkartAdapter implements MarketplaceAdapter {
  readonly platform = 'FLIPKART' as const;

  private readonly api: FlipkartAffiliateFetcher;
  private readonly http: HttpFetcher;
  private browserPool: BrowserPool | undefined;
  private playwright: PlaywrightFetcher | undefined;

  constructor(private readonly options: FlipkartAdapterOptions = {}) {
    this.api = new FlipkartAffiliateFetcher(options.affiliate);
    this.http = new HttpFetcher(parseFlipkartProduct, {
      fetchImpl: options.fetchImpl,
    });
  }

  private getPlaywright(): PlaywrightFetcher | undefined {
    if (this.options.enableBrowserFallback === false) return undefined;
    if (!this.playwright) {
      this.browserPool = new BrowserPool(this.options.browser);
      this.playwright = new PlaywrightFetcher(this.browserPool, parseFlipkartProduct, {
        readySelector: FLIPKART_SELECTORS.title[0],
      });
    }
    return this.playwright;
  }

  async fetchProduct(request: FetchRequest): Promise<FetchOutcome> {
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

        // Terminal for every strategy. A browser cannot un-delete a listing,
        // and cannot make selectors match HTML they already failed on.
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
