import {
  FetchError,
  type FetchOutcome,
  type FetchRequest,
  type FetchStrategy,
} from '../adapter';
import { validateFetchedProduct, type RawFetchedProduct } from '../product-data.schema';
import { normalizeAvailability } from '../shared/availability';
import { computeDiscountPercent } from '../shared/price';
import { cleanText } from '../shared/text';

export interface FlipkartAffiliateConfig {
  affiliateId: string;
  affiliateToken: string;
  baseUrl?: string;
}

/**
 * Flipkart Affiliate API strategy.
 *
 * ACCESS RISK, stated plainly: Flipkart's affiliate programme has had extended
 * periods of restricted or closed onboarding, and the product-feed endpoints
 * have changed shape more than once. Treat this path as opportunistic — the
 * scraping strategy is the full implementation and is expected to carry
 * Flipkart in practice.
 *
 * Authentication is a pair of headers rather than a request signature, which
 * makes this considerably simpler than Amazon's SigV4 — but also means the
 * credentials are bearer-equivalent and must never reach the frontend.
 *
 * NOT VERIFIED against the live service — there are no credentials in this
 * environment. Response mapping follows the documented product-feed shape.
 */
export class FlipkartAffiliateFetcher implements FetchStrategy {
  readonly name = 'API' as const;

  private readonly baseUrl: string;

  constructor(private readonly config: FlipkartAffiliateConfig | undefined) {
    this.baseUrl = config?.baseUrl ?? 'https://affiliate-api.flipkart.net/affiliate';
  }

  isAvailable(): boolean {
    return Boolean(this.config?.affiliateId && this.config?.affiliateToken);
  }

  async fetch(request: FetchRequest): Promise<FetchOutcome> {
    if (!this.config || !this.isAvailable()) {
      throw new FetchError('UNSUPPORTED', 'Flipkart affiliate credentials are not configured');
    }

    const started = Date.now();
    const url = `${this.baseUrl}/1.0/product.json?id=${encodeURIComponent(request.externalId)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 15_000);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'Fk-Affiliate-Id': this.config.affiliateId,
          'Fk-Affiliate-Token': this.config.affiliateToken,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new FetchError(aborted ? 'TIMEOUT' : 'NETWORK', 'Affiliate API request failed', {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new FetchError(
        response.status === 404
          ? 'NOT_FOUND'
          : response.status === 429
            ? 'QUOTA_EXHAUSTED'
            : 'API_ERROR',
        `Flipkart affiliate API HTTP ${response.status}`,
        { httpStatus: response.status },
      );
    }

    const body = (await response.json()) as FlipkartProductResponse;
    const base = body.productBaseInfoV1;

    if (!base) {
      throw new FetchError('NOT_FOUND', `No product returned for ${request.externalId}`);
    }

    const raw = toRawProduct(base, request);
    const validated = validateFetchedProduct(raw);

    if (!validated.ok) {
      throw new FetchError(
        'VALIDATION_FAILED',
        `Affiliate API data failed validation: ${validated.issues
          .map((i) => `${i.path}: ${i.message}`)
          .join('; ')}`,
        { issues: validated.issues, httpStatus: response.status },
      );
    }

    return {
      product: validated.data,
      strategy: this.name,
      durationMs: Date.now() - started,
      httpStatus: response.status,
    };
  }
}

function toRawProduct(
  base: FlipkartProductBaseInfo,
  request: FetchRequest,
): RawFetchedProduct {
  // Flipkart quotes amounts in whole rupees; minor units are ours to compute.
  const priceMinor = toMinor(base.flipkartSellingPrice?.amount);
  const mrpMinor = toMinor(base.maximumRetailPrice?.amount);

  return {
    platform: 'FLIPKART',
    externalId: base.productId ?? request.externalId,
    url: base.productUrl ?? request.url,
    source: 'API',
    fetchedAt: new Date(),

    title: cleanText(base.title),
    brand: cleanText(base.productBrand) || undefined,
    currency: base.flipkartSellingPrice?.currency ?? 'INR',
    priceMinor,
    mrpMinor,
    discountPercent: computeDiscountPercent(priceMinor, mrpMinor),
    availability: base.inStock
      ? 'IN_STOCK'
      : normalizeAvailability(base.availability ?? 'out of stock'),
    imageUrl: base.imageUrls?.['400x400'] ?? base.imageUrls?.['200x200'],

    rawAttributes: {},
    platformData: {
      source: 'flipkart-affiliate',
      ...(base.discountPercentage !== undefined
        ? { reportedDiscount: base.discountPercentage }
        : {}),
    },
  };
}

function toMinor(amount: number | undefined): number | undefined {
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return undefined;
  return Math.round(amount * 100);
}

interface FlipkartProductResponse {
  productBaseInfoV1?: FlipkartProductBaseInfo;
}

interface FlipkartProductBaseInfo {
  productId?: string;
  title?: string;
  productBrand?: string;
  productUrl?: string;
  inStock?: boolean;
  availability?: string;
  discountPercentage?: number;
  maximumRetailPrice?: { amount?: number; currency?: string };
  flipkartSellingPrice?: { amount?: number; currency?: string };
  imageUrls?: Record<string, string>;
}
