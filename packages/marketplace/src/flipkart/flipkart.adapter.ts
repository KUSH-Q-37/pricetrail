import { searchUnavailable } from '../search';
import { parseFlipkartSearchResults } from './flipkart.search';
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

  /**
   * Search Flipkart for candidate products, for counterpart discovery.
   *
   * Scrapes the search-results page, because Flipkart has no public product
   * API and its Affiliate programme has had long periods of closed onboarding
   * (see flipkart.api.ts). Only the FSN and product URL are taken; see
   * flipkart.search.ts for why nothing else is read from the grid.
   *
   * Every candidate is a suggestion. Search relevance will happily return a
   * phone case for a phone query, and deciding equivalence is the matching
   * engine's job — its veto rules exist for exactly this input.
   */
  async searchProducts(query: string, limit = 5): Promise<ProductSearchResult> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return searchUnavailable('empty query', false);

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const url = `https://www.flipkart.com/search?q=${encodeURIComponent(trimmed)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let html: string;
    try {
      const response = await fetchImpl(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'accept-language': 'en-IN,en;q=0.9',
          accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        // Retryable: a blocked or rate-limited search may well work later,
        // unlike a missing credential.
        return searchUnavailable(`Flipkart search HTTP ${response.status}`, true);
      }

      html = await response.text();
    } catch (error) {
      return searchUnavailable(
        `Flipkart search request failed: ${error instanceof Error ? error.message : 'unknown'}`,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    const candidates = parseFlipkartSearchResults(html, limit);

    // Zero results from a page that loaded is reported as an available search
    // that found nothing — NOT as unavailability. Conflating the two would let
    // a genuinely empty result look like a broken integration, and vice versa.
    return { available: true, candidates };
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
