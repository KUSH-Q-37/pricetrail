import {
  FetchError,
  type FetchErrorReason,
  type FetchOutcome,
  type FetchRequest,
  type FetchStrategy,
} from '../adapter';
import { BotChallengeError } from '../errors';
import { validateFetchedProduct } from '../product-data.schema';
import type { ParseFunction } from './parse-function';

export interface HttpFetcherOptions {
  userAgent?: string;
  /** Proxy-aware fetch, injected by the worker in Phase 11. */
  fetchImpl?: typeof fetch;
  extraHeaders?: Record<string, string>;
}

/**
 * Plain HTTP + parser. Platform-agnostic.
 *
 * Roughly 50x cheaper than a browser — no process, no ~400 MB Chromium
 * context, tens of milliseconds instead of tens of seconds — so it is always
 * tried first.
 *
 * Parameterised by a ParseFunction rather than subclassed per marketplace:
 * the fetch, status mapping, validation and error taxonomy are identical for
 * Amazon and Flipkart, and duplicating them would mean fixing every retry or
 * header bug twice.
 */
export class HttpFetcher implements FetchStrategy {
  readonly name = 'HTTP_CHEERIO' as const;

  constructor(
    private readonly parse: ParseFunction,
    private readonly options: HttpFetcherOptions = {},
  ) {}

  isAvailable(): boolean {
    return true;
  }

  async fetch(request: FetchRequest): Promise<FetchOutcome> {
    const started = Date.now();
    const doFetch = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 20_000);

    let response: Response;
    try {
      response = await doFetch(request.url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent':
            this.options.userAgent ??
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          // A request that omits these is trivially distinguishable from a
          // browser by any bot filter.
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-IN,en;q=0.9',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          ...this.options.extraHeaders,
        },
      });
    } catch (error) {
      clearTimeout(timeout);
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new FetchError(
        aborted ? 'TIMEOUT' : 'NETWORK',
        aborted ? 'Request timed out' : 'Network request failed',
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new FetchError(mapStatus(response.status), `HTTP ${response.status}`, {
        httpStatus: response.status,
      });
    }

    const html = await response.text();
    return finishFetch({
      html,
      request,
      parse: this.parse,
      strategy: this.name,
      startedAt: started,
      httpStatus: response.status,
    });
  }
}

export function mapStatus(status: number): FetchErrorReason {
  if (status === 404 || status === 410) return 'NOT_FOUND';
  if (status === 429 || status === 503) return 'RATE_LIMITED';
  if (status === 403) return 'BLOCKED';
  return 'NETWORK';
}

/**
 * Parse → validate → wrap. Shared by both fetch strategies so a page obtained
 * by browser and the same page obtained by HTTP are treated identically.
 */
export function finishFetch(input: {
  html: string;
  request: FetchRequest;
  parse: ParseFunction;
  strategy: FetchOutcome['strategy'];
  startedAt: number;
  httpStatus?: number;
}): FetchOutcome {
  let raw;
  try {
    raw = input.parse(input.html, {
      externalId: input.request.externalId,
      url: input.request.url,
      source: 'SCRAPE',
    });
  } catch (error) {
    if (error instanceof BotChallengeError) {
      throw new FetchError('BOT_CHALLENGE', error.message, {
        httpStatus: input.httpStatus,
      });
    }
    throw new FetchError('PARSE_FAILED', 'Failed to parse the product page', {
      cause: error,
    });
  }

  const validated = validateFetchedProduct(raw);
  if (!validated.ok) {
    // Never partially persist. The issues travel with the error so the
    // scrape_jobs row records WHICH field failed — the difference between
    // "a selector broke" and "the page changed shape".
    throw new FetchError(
      'VALIDATION_FAILED',
      `Fetched data failed validation: ${validated.issues
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ')}`,
      { issues: validated.issues, httpStatus: input.httpStatus },
    );
  }

  return {
    product: validated.data,
    strategy: input.strategy,
    durationMs: Date.now() - input.startedAt,
    httpStatus: input.httpStatus,
  };
}
