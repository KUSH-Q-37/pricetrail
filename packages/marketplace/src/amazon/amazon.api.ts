import {
  FetchError,
  type FetchOutcome,
  type FetchRequest,
  type FetchStrategy,
} from '../adapter';
import { validateFetchedProduct } from '../product-data.schema';
import type { RawFetchedProduct } from '../product-data.schema';
import { searchUnavailable } from '../search';
import type { ProductSearchCandidate, ProductSearchResult } from '../search';
import { normalizeAvailability } from '../shared/availability';
import { computeDiscountPercent } from '../shared/price';
import { cleanText } from '../shared/text';
import { CreatorsTokenProvider, type CreatorsVersion } from './creators-auth';

export interface CreatorsApiConfig {
  /** `amzn1.application-oa2-client.…` */
  clientId: string;
  /** `amzn1.oa2-cs.v1.…` */
  clientSecret: string;
  /**
   * Credential version, which selects the token endpoint. amazon.in
   * credentials are v3.2 (EU) — see creators-auth.ts.
   */
  version?: CreatorsVersion;
  /** Associates tracking ID. Every request is rejected without it. */
  partnerTag: string;
  /** Marketplace host. Defaults to the India marketplace. */
  marketplace?: string;
}

/** Base host for every Creators API operation, in every region. */
const CREATORS_API_BASE = 'https://creatorsapi.amazon';

/**
 * getItems batches ASINs in one call, exactly as PA-API's GetItems did.
 *
 * Ten is carried over from PA-API's documented cap. If the Creators API turns
 * out to allow more, this is the one number to raise; if it allows fewer, the
 * API returns a 400 naming the limit.
 */
export const CREATORS_MAX_BATCH = 10;

/**
 * Requested resources, in the Creators API's lowerCamelCase spelling.
 *
 * These are the same fields the PA-API integration asked for — the migration
 * renamed them (`ItemInfo.Title` became `itemInfo.title`) without changing
 * what they mean.
 */
const RESOURCES = [
  'itemInfo.title',
  'itemInfo.byLineInfo',
  'itemInfo.externalIds',
  'itemInfo.manufactureInfo',
  'itemInfo.productInfo',
  // Carries productGroup and binding, which is Amazon's own statement of what
  // a product IS. Tracking scope depends on it: without this, an Amazon
  // listing states no category, and a product nobody can classify is a product
  // nobody can exclude.
  'itemInfo.classifications',
  'itemInfo.technicalInfo',
  'offers.listings.price',
  'offers.listings.savingBasis',
  'offers.listings.availability.message',
  'offers.listings.merchantInfo',
  'images.primary.large',
];

/**
 * Amazon Creators API — the PRIMARY strategy.
 *
 * Replaces the Product Advertising API, which Amazon retired on 15 May 2026.
 * The catalogue data is the same; what changed is the transport:
 *
 *   - OAuth 2.0 bearer tokens instead of AWS Signature Version 4.
 *   - A single global host (creatorsapi.amazon) with the marketplace named in
 *     a header, instead of a per-region webservices.amazon.* host.
 *   - lowerCamelCase request and response fields instead of PascalCase.
 *
 * Why this still beats scraping wherever it is available:
 *   - Brand, Model, PartNumber, EAN and UPC arrive as STRUCTURED fields rather
 *     than regex guesses from a spec table. Matching Layer 1 stops guessing,
 *     which is the single largest accuracy win in the project.
 *   - No anti-bot, no proxies, no layout changes. Amazon.in currently answers
 *     every scrape attempt with a bot challenge, so for Amazon this is not an
 *     optimisation — it is the only route that works at all.
 *   - Batching makes the daily sweep ~20x faster.
 *
 * Access caveats worth confirming before depending on it: credentials require
 * an approved Associates account that has made qualifying sales. If access
 * lapses, the scraping strategy is already the full implementation and simply
 * becomes primary again.
 *
 * NOT VERIFIED against the live service — there are no credentials in this
 * environment. The request contract follows Amazon's published Creators API
 * documentation; the response parser deliberately accepts either casing (see
 * `prop`) because the exact response spelling is the one part of the contract
 * the docs do not pin down unambiguously.
 */
export class AmazonApiFetcher implements FetchStrategy {
  readonly name = 'API' as const;

  private readonly marketplace: string;
  private readonly tokens: CreatorsTokenProvider | undefined;

  constructor(private readonly config: CreatorsApiConfig | undefined) {
    this.marketplace = config?.marketplace ?? 'www.amazon.in';
    this.tokens =
      config?.clientId && config?.clientSecret
        ? new CreatorsTokenProvider({
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            version: config.version ?? 'v3.2',
          })
        : undefined;
  }

  isAvailable(): boolean {
    return Boolean(
      this.config?.clientId && this.config?.clientSecret && this.config?.partnerTag,
    );
  }

  async fetch(request: FetchRequest): Promise<FetchOutcome> {
    const results = await this.fetchMany([request.externalId], request.timeoutMs);
    const product = results.get(request.externalId);

    if (!product) {
      throw new FetchError(
        'NOT_FOUND',
        `Creators API returned no item for ${request.externalId}`,
      );
    }

    return product;
  }

  /**
   * Batch fetch. This is the method the daily worker should call — issuing ten
   * single-item requests wastes 90% of a rate-limited quota.
   */
  async fetchMany(
    asins: string[],
    timeoutMs = 15_000,
  ): Promise<Map<string, FetchOutcome>> {
    if (!this.config || !this.tokens || !this.isAvailable()) {
      throw new FetchError('UNSUPPORTED', 'Creators API credentials are not configured');
    }
    if (asins.length === 0) return new Map();
    if (asins.length > CREATORS_MAX_BATCH) {
      throw new FetchError(
        'UNSUPPORTED',
        `Creators API accepts at most ${CREATORS_MAX_BATCH} items per request, got ${asins.length}`,
      );
    }

    const started = Date.now();
    const response = await this.call(
      '/catalog/v1/getItems',
      {
        itemIds: asins,
        itemIdType: 'ASIN',
        marketplace: this.marketplace,
        partnerTag: this.config.partnerTag,
        resources: RESOURCES,
      },
      timeoutMs,
    );

    if (!response.ok) {
      // 429 means the quota is spent for now. Surfaced distinctly so the
      // adapter can fall back to scraping instead of failing the job.
      throw new FetchError(
        response.status === 429 ? 'QUOTA_EXHAUSTED' : 'API_ERROR',
        `Creators API HTTP ${response.status}`,
        { httpStatus: response.status },
      );
    }

    const body = (await response.json()) as unknown;
    const durationMs = Date.now() - started;
    const outcomes = new Map<string, FetchOutcome>();

    for (const item of itemsFrom(body, 'itemsResult')) {
      const asin = prop<string>(item, 'ASIN');
      if (!asin) continue;

      const validated = validateFetchedProduct(this.toRawProduct(item, asin));
      if (!validated.ok) {
        // One bad item must not discard the other nine in the batch.
        continue;
      }

      outcomes.set(asin, {
        product: validated.data,
        strategy: this.name,
        durationMs,
        httpStatus: response.status,
      });
    }

    return outcomes;
  }

  /**
   * Find candidate ASINs by keywords, for counterpart discovery.
   *
   * searchItems, sharing this class's token provider and item mapping with
   * getItems. Its results are ranked by Amazon's relevance, not by any notion
   * of equivalence — so every candidate returned here is a SUGGESTION.
   * Deciding whether one is actually the same product is the matching engine's
   * job, and its veto rules exist precisely because search relevance will
   * happily return a phone case for a phone query.
   */
  async searchProducts(query: string, limit = 5): Promise<ProductSearchResult> {
    if (!this.config || !this.tokens || !this.isAvailable()) {
      // A configuration fact, not a failure: retrying changes nothing.
      return searchUnavailable('Creators API credentials are not configured', false);
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return searchUnavailable('empty query', false);
    }

    let response: Response;
    try {
      response = await this.call(
        '/catalog/v1/searchItems',
        {
          keywords: trimmed,
          itemCount: Math.min(Math.max(limit, 1), 10),
          marketplace: this.marketplace,
          partnerTag: this.config.partnerTag,
          resources: RESOURCES,
        },
        15_000,
      );
    } catch (error) {
      // Network trouble and token failures are retryable, unlike missing
      // credentials. Search must never throw — a counterpart we could not look
      // up is a gap in coverage, not a failed job.
      return searchUnavailable(
        `Creators API search request failed: ${error instanceof Error ? error.message : 'unknown'}`,
        true,
      );
    }

    if (!response.ok) {
      // 404 means "no results", which is an answer, not a fault. A spent quota
      // (429) is retryable later today; 401/403 means the credentials are not
      // active — Amazon issues them before an account qualifies to use them —
      // and no amount of retrying fixes that.
      if (response.status === 404) {
        return { available: true, candidates: [] };
      }
      return searchUnavailable(
        `Creators API search HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }

    const body = (await response.json()) as unknown;
    const candidates: ProductSearchCandidate[] = [];

    for (const item of itemsFrom(body, 'searchResult')) {
      const asin = prop<string>(item, 'ASIN');
      if (!asin) continue;

      const raw = this.toRawProduct(item, asin);
      if (!raw.title) continue;

      candidates.push({
        externalId: raw.externalId,
        url: raw.url,
        title: raw.title,
        brand: raw.brand,
        priceMinor: raw.priceMinor,
        imageUrl: raw.imageUrl,
        ean: raw.ean,
        upc: raw.upc,
        modelNumber: raw.modelNumber,
        mpn: raw.mpn,
      });
    }

    return { available: true, candidates };
  }

  /**
   * One authenticated POST, with a single retry after a 401.
   *
   * The retry matters because a cached token can stop being accepted before
   * its stated expiry — rotating the credential does exactly that. Without it,
   * every request until the natural expiry fails, which for an hour-long token
   * means a whole daily sweep lost to a condition that one re-authentication
   * would have cleared.
   */
  private async call(
    path: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
    isRetry = false,
  ): Promise<Response> {
    const token = await this.tokens!.getToken();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${CREATORS_API_BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-marketplace': this.marketplace,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new FetchError(aborted ? 'TIMEOUT' : 'NETWORK', 'Creators API request failed', {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 && !isRetry) {
      this.tokens!.invalidate();
      return this.call(path, payload, timeoutMs, true);
    }

    return response;
  }

  private toRawProduct(item: unknown, asin: string): RawFetchedProduct {
    const listing = (prop<unknown[]>(prop(item, 'Offers'), 'Listings') ?? [])[0];
    const info = prop(item, 'ItemInfo');

    const price = prop(listing, 'Price');
    const priceMinor = toMinor(prop<number>(price, 'Amount'));
    const mrpMinor = toMinor(prop<number>(prop(listing, 'SavingBasis'), 'Amount'));

    const manufacture = prop(info, 'ManufactureInfo');
    const model = displayValue(prop(manufacture, 'Model'));
    const colour = displayValue(prop(prop(info, 'ProductInfo'), 'Color'));

    const rawAttributes: Record<string, string> = {};
    for (const format of displayValues(prop(prop(info, 'TechnicalInfo'), 'Formats'))) {
      rawAttributes['Format'] = format;
    }
    if (colour) rawAttributes['Colour'] = colour;
    if (model) rawAttributes['Item model number'] = model;

    const externalIds = prop(info, 'ExternalIds');

    // productGroup first, binding as the fallback. ProductGroup is the coarser
    // and more consistently populated of the two ("Personal Computer",
    // "Shoes"); Binding is finer but often a format word rather than a
    // category, so it is only worth reading when the group is absent.
    const classifications = prop(info, 'Classifications');
    const platformCategory =
      displayValue(prop(classifications, 'ProductGroup')) ??
      displayValue(prop(classifications, 'Binding'));

    return {
      platform: 'AMAZON',
      externalId: asin,
      url: prop<string>(item, 'DetailPageURL') ?? `https://${this.marketplace}/dp/${asin}`,
      source: 'API',
      fetchedAt: new Date(),

      title: cleanText(displayValue(prop(info, 'Title'))),
      brand: cleanText(displayValue(prop(prop(info, 'ByLineInfo'), 'Brand'))) || undefined,
      modelNumber: cleanText(model) || undefined,
      mpn: cleanText(displayValue(prop(manufacture, 'PartNumber'))) || undefined,
      ean: firstDigits(displayValues(prop(externalIds, 'EANs')), 8, 14),
      upc: firstDigits(displayValues(prop(externalIds, 'UPCs')), 12, 12),

      currency: prop<string>(price, 'Currency') ?? 'INR',
      priceMinor,
      mrpMinor,
      discountPercent: computeDiscountPercent(priceMinor, mrpMinor),
      availability: normalizeAvailability(
        prop<string>(prop(listing, 'Availability'), 'Message'),
      ),

      sellerName:
        cleanText(prop<string>(prop(listing, 'MerchantInfo'), 'Name')) || undefined,
      imageUrl: prop<string>(prop(prop(prop(item, 'Images'), 'Primary'), 'Large'), 'URL'),

      platformCategory: cleanText(platformCategory) || undefined,

      rawAttributes,
      platformData: { source: 'creators-api' },
    };
  }
}

/**
 * Case-insensitive property read.
 *
 * The Creators API migration renamed request AND response fields to
 * lowerCamelCase, but the published examples are not consistent enough to pin
 * every response key with confidence — `parentASIN` implies `ASIN` becomes
 * `asin` and `EANs` becomes `eANs`, which is mechanical but odd enough that it
 * is worth not betting the integration on.
 *
 * Reading case-insensitively costs one lowercase comparison per field and
 * makes the parser correct under either spelling, including a future
 * correction to one of them. Every key we read is unique within its object
 * ignoring case, so there is no ambiguity to resolve.
 */
function prop<T = unknown>(source: unknown, name: string): T | undefined {
  if (source === null || typeof source !== 'object') return undefined;

  const record = source as Record<string, unknown>;
  if (name in record) return record[name] as T;

  const lower = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lower) return record[key] as T;
  }

  return undefined;
}

/** `{ displayValue: "…" }` wrappers, under either casing. */
function displayValue(source: unknown): string | undefined {
  return prop<string>(source, 'DisplayValue');
}

function displayValues(source: unknown): string[] {
  const values = prop<unknown>(source, 'DisplayValues');
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string')
    : [];
}

/** `itemsResult.items` / `searchResult.items`, under either casing. */
function itemsFrom(body: unknown, container: string): unknown[] {
  const items = prop<unknown>(prop(body, container), 'Items');
  return Array.isArray(items) ? items : [];
}

/**
 * The API returns Amount as a decimal number of rupees (1299.5), not paise.
 * Multiplying by 100 in floating point then truncating loses a paisa on values
 * like 1299.5 -> 129949.99999; rounding is required, not optional.
 */
function toMinor(amount: number | undefined): number | undefined {
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return undefined;
  return Math.round(amount * 100);
}

function firstDigits(values: string[], min: number, max: number): string | undefined {
  for (const value of values) {
    const digits = value.replace(/\D/g, '');
    if (digits.length >= min && digits.length <= max) return digits;
  }
  return undefined;
}
