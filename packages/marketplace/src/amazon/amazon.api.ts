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
import { signRequest } from './paapi-signer';

export interface PaapiConfig {
  accessKey: string;
  secretKey: string;
  /** Associates tag. PA-API rejects requests without it. */
  partnerTag: string;
  /** Defaults to the India marketplace. */
  host?: string;
  region?: string;
}

/**
 * PA-API GetItems batches up to 10 ASINs per call. At the initial 1 TPS floor
 * that turns a 10 000-listing sweep into ~1 000 requests / ~17 minutes,
 * against roughly 6 hours of jittered scraping.
 */
export const PAAPI_MAX_BATCH = 10;

const RESOURCES = [
  'ItemInfo.Title',
  'ItemInfo.ByLineInfo',
  'ItemInfo.ExternalIds',
  'ItemInfo.ManufactureInfo',
  'ItemInfo.ProductInfo',
  'ItemInfo.TechnicalInfo',
  'Offers.Listings.Price',
  'Offers.Listings.SavingBasis',
  'Offers.Listings.Availability.Message',
  'Offers.Listings.MerchantInfo',
  'Images.Primary.Large',
];

/**
 * Amazon Product Advertising API 5.0 — the PRIMARY strategy.
 *
 * Why this beats scraping wherever it is available:
 *   - Brand, Model, PartNumber, EAN and UPC arrive as STRUCTURED fields
 *     rather than regex guesses from a spec table. Matching Layer 1 stops
 *     guessing, which is the single largest accuracy win in the project.
 *   - No anti-bot, no proxies, no layout changes.
 *   - Batching makes the daily sweep ~20x faster.
 *
 * Access caveats worth confirming before depending on it: PA-API requires an
 * approved Associates account AND qualifying sales to retain credentials.
 * If access lapses, the scraping strategy is already the full implementation
 * and simply becomes primary again.
 *
 * NOT VERIFIED against the live service — there are no credentials in this
 * environment. The signing steps are unit-tested for determinism and format;
 * the request/response contract follows the published PA-API 5.0 shape.
 */
export class AmazonApiFetcher implements FetchStrategy {
  readonly name = 'API' as const;

  private readonly host: string;
  private readonly region: string;

  constructor(private readonly config: PaapiConfig | undefined) {
    this.host = config?.host ?? 'webservices.amazon.in';
    // India's PA-API endpoint is served from eu-west-1.
    this.region = config?.region ?? 'eu-west-1';
  }

  isAvailable(): boolean {
    return Boolean(
      this.config?.accessKey && this.config?.secretKey && this.config?.partnerTag,
    );
  }

  async fetch(request: FetchRequest): Promise<FetchOutcome> {
    const results = await this.fetchMany([request.externalId], request.timeoutMs);
    const product = results.get(request.externalId);

    if (!product) {
      throw new FetchError('NOT_FOUND', `PA-API returned no item for ${request.externalId}`);
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
    if (!this.config || !this.isAvailable()) {
      throw new FetchError('UNSUPPORTED', 'PA-API credentials are not configured');
    }
    if (asins.length === 0) return new Map();
    if (asins.length > PAAPI_MAX_BATCH) {
      throw new FetchError(
        'UNSUPPORTED',
        `PA-API accepts at most ${PAAPI_MAX_BATCH} items per request, got ${asins.length}`,
      );
    }

    const started = Date.now();
    const path = '/paapi5/getitems';
    const payload = JSON.stringify({
      ItemIds: asins,
      ItemIdType: 'ASIN',
      Resources: RESOURCES,
      PartnerTag: this.config.partnerTag,
      PartnerType: 'Associates',
      Marketplace: `www.${this.host.replace(/^webservices\./, '')}`,
    });

    const signed = signRequest({
      method: 'POST',
      host: this.host,
      path,
      region: this.region,
      service: 'ProductAdvertisingAPI',
      target: 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems',
      payload,
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(`https://${this.host}${path}`, {
        method: 'POST',
        headers: signed.headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new FetchError(aborted ? 'TIMEOUT' : 'NETWORK', 'PA-API request failed', {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // 429 means the quota is spent for now. Surfaced distinctly so the
      // adapter can fall back to scraping instead of failing the job.
      const reason =
        response.status === 429
          ? 'QUOTA_EXHAUSTED'
          : response.status === 401 || response.status === 403
            ? 'API_ERROR'
            : 'API_ERROR';
      throw new FetchError(reason, `PA-API HTTP ${response.status}`, {
        httpStatus: response.status,
      });
    }

    const body = (await response.json()) as PaapiGetItemsResponse;
    const durationMs = Date.now() - started;
    const outcomes = new Map<string, FetchOutcome>();

    for (const item of body.ItemsResult?.Items ?? []) {
      const raw = this.toRawProduct(item);
      const validated = validateFetchedProduct(raw);

      if (!validated.ok) {
        // One bad item must not discard the other nine in the batch.
        continue;
      }

      outcomes.set(item.ASIN, {
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
   * PA-API SearchItems, sharing this class's signer and item mapping with
   * GetItems. It is a separate operation with its own quota, and its results
   * are ranked by Amazon's relevance, not by any notion of equivalence — so
   * every candidate returned here is a SUGGESTION. Deciding whether one is
   * actually the same product is the matching engine's job, and its veto rules
   * exist precisely because search relevance will happily return a phone case
   * for a phone query.
   *
   * ItemCount is capped at 10 by the API.
   */
  async searchProducts(query: string, limit = 5): Promise<ProductSearchResult> {
    if (!this.config || !this.isAvailable()) {
      // A configuration fact, not a failure: retrying changes nothing.
      return searchUnavailable('PA-API credentials are not configured', false);
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return searchUnavailable('empty query', false);
    }

    const path = '/paapi5/searchitems';
    const payload = JSON.stringify({
      Keywords: trimmed,
      SearchIndex: 'All',
      ItemCount: Math.min(Math.max(limit, 1), 10),
      Resources: RESOURCES,
      PartnerTag: this.config.partnerTag,
      PartnerType: 'Associates',
      Marketplace: `www.${this.host.replace(/^webservices\./, '')}`,
    });

    const signed = signRequest({
      method: 'POST',
      host: this.host,
      path,
      region: this.region,
      service: 'ProductAdvertisingAPI',
      target: 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems',
      payload,
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let response: Response;
    try {
      response = await fetch(`https://${this.host}${path}`, {
        method: 'POST',
        headers: signed.headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (error) {
      // Network trouble is retryable, unlike missing credentials.
      return searchUnavailable(
        `PA-API search request failed: ${error instanceof Error ? error.message : 'unknown'}`,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // 404 from SearchItems means "no results", which is an answer, not a
      // fault. A spent quota (429) is retryable later today; 401/403 means the
      // credentials are not active — PA-API issues keys before the account
      // qualifies to use them — and no amount of retrying fixes that.
      if (response.status === 404) {
        return { available: true, candidates: [] };
      }
      return searchUnavailable(
        `PA-API search HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }

    const body = (await response.json()) as PaapiSearchItemsResponse;
    const candidates: ProductSearchCandidate[] = [];

    for (const item of body.SearchResult?.Items ?? []) {
      const raw = this.toRawProduct(item);
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

  private toRawProduct(item: PaapiItem): RawFetchedProduct {
    const listing = item.Offers?.Listings?.[0];
    const info = item.ItemInfo;

    const priceMinor = toMinor(listing?.Price?.Amount);
    const mrpMinor = toMinor(listing?.SavingBasis?.Amount);

    const rawAttributes: Record<string, string> = {};
    for (const spec of info?.TechnicalInfo?.Formats?.DisplayValues ?? []) {
      rawAttributes['Format'] = spec;
    }
    if (info?.ProductInfo?.Color?.DisplayValue) {
      rawAttributes['Colour'] = info.ProductInfo.Color.DisplayValue;
    }
    if (info?.ManufactureInfo?.Model?.DisplayValue) {
      rawAttributes['Item model number'] = info.ManufactureInfo.Model.DisplayValue;
    }

    return {
      platform: 'AMAZON',
      externalId: item.ASIN,
      url: item.DetailPageURL,
      source: 'API',
      fetchedAt: new Date(),

      title: cleanText(info?.Title?.DisplayValue),
      brand: cleanText(info?.ByLineInfo?.Brand?.DisplayValue) || undefined,
      modelNumber: cleanText(info?.ManufactureInfo?.Model?.DisplayValue) || undefined,
      mpn: cleanText(info?.ManufactureInfo?.PartNumber?.DisplayValue) || undefined,
      ean: firstDigits(info?.ExternalIds?.EANs?.DisplayValues, 8, 14),
      upc: firstDigits(info?.ExternalIds?.UPCs?.DisplayValues, 12, 12),

      currency: listing?.Price?.Currency ?? 'INR',
      priceMinor,
      mrpMinor,
      discountPercent: computeDiscountPercent(priceMinor, mrpMinor),
      availability: normalizeAvailability(listing?.Availability?.Message),

      sellerName: cleanText(listing?.MerchantInfo?.Name) || undefined,
      imageUrl: item.Images?.Primary?.Large?.URL,

      rawAttributes,
      platformData: { source: 'paapi5' },
    };
  }
}

/**
 * PA-API returns Amount as a decimal number of rupees (1299.5), not paise.
 * Multiplying by 100 in floating point then truncating loses a paisa on values
 * like 1299.5 -> 129949.99999; rounding is required, not optional.
 */
function toMinor(amount: number | undefined): number | undefined {
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return undefined;
  return Math.round(amount * 100);
}

function firstDigits(
  values: string[] | undefined,
  min: number,
  max: number,
): string | undefined {
  for (const value of values ?? []) {
    const digits = value.replace(/\D/g, '');
    if (digits.length >= min && digits.length <= max) return digits;
  }
  return undefined;
}

// --- Minimal response typings for the resources we request ------------------
interface PaapiSearchItemsResponse {
  SearchResult?: { Items?: PaapiItem[] };
}

interface PaapiGetItemsResponse {
  ItemsResult?: { Items?: PaapiItem[] };
  Errors?: Array<{ Code: string; Message: string }>;
}

interface PaapiItem {
  ASIN: string;
  DetailPageURL: string;
  Images?: { Primary?: { Large?: { URL: string } } };
  ItemInfo?: {
    Title?: { DisplayValue: string };
    ByLineInfo?: { Brand?: { DisplayValue: string } };
    ExternalIds?: {
      EANs?: { DisplayValues: string[] };
      UPCs?: { DisplayValues: string[] };
    };
    ManufactureInfo?: {
      Model?: { DisplayValue: string };
      PartNumber?: { DisplayValue: string };
    };
    ProductInfo?: { Color?: { DisplayValue: string } };
    TechnicalInfo?: { Formats?: { DisplayValues: string[] } };
  };
  Offers?: {
    Listings?: Array<{
      Price?: { Amount: number; Currency: string };
      SavingBasis?: { Amount: number };
      Availability?: { Message?: string };
      MerchantInfo?: { Name?: string };
    }>;
  };
}
