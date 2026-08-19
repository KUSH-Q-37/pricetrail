import { z } from 'zod';

import { MAX_PRICE_MINOR } from './shared/price';

/**
 * THE BOUNDARY.
 *
 * Everything a fetcher produces — whether from the Creators API, a plain HTTP fetch, or
 * a headless browser — must pass this schema before it touches the database.
 *
 * This is the single most important validation in the system, and it is not
 * about HTTP hygiene. Price history is append-only and never edited: a bad
 * value written today is visible in every chart forever, and there is no
 * "the price was actually X" correction path that does not amount to
 * falsifying the record. It is strictly better to record NOTHING for a day
 * than to record a number we are not sure about — a gap is honest, a wrong
 * point is a lie.
 *
 * So the rule throughout is: reject, do not coerce. A scraper that returns
 * `price: 0` because a selector broke must fail loudly and leave a gap.
 */

export const AvailabilitySchema = z.enum([
  'IN_STOCK',
  'OUT_OF_STOCK',
  'LIMITED_STOCK',
  'PREORDER',
  'DISCONTINUED',
  'UNKNOWN',
]);

export const PlatformSchema = z.enum(['AMAZON', 'FLIPKART']);
export const DataSourceSchema = z.enum(['API', 'SCRAPE']);

/** Money: positive integers only. No floats, no zero, no strings. */
const PriceMinorSchema = z
  .number()
  .int('Prices must be integer minor units (paise), never a float')
  .positive('A price of zero or less is a parse failure, not a price')
  .max(MAX_PRICE_MINOR);

export const FetchedProductSchema = z
  .object({
    platform: PlatformSchema,
    externalId: z.string().min(1).max(64),
    url: z.string().min(1).max(2048),
    source: DataSourceSchema,

    title: z.string().min(3, 'A title under 3 characters means the selector broke').max(512),

    brand: z.string().min(1).max(120).optional(),
    modelNumber: z.string().min(1).max(120).optional(),
    mpn: z.string().min(1).max(120).optional(),
    ean: z.string().regex(/^\d{8,14}$/, 'EAN must be 8-14 digits').optional(),
    upc: z.string().regex(/^\d{12}$/, 'UPC must be 12 digits').optional(),

    currency: z.string().length(3).default('INR'),

    /**
     * Optional because an out-of-stock listing genuinely has no price. That is
     * a legitimate observation, not a failure — see the cross-field rule below
     * for the case that is.
     */
    priceMinor: PriceMinorSchema.optional(),
    mrpMinor: PriceMinorSchema.optional(),
    discountPercent: z.number().int().min(1).max(99).optional(),

    availability: AvailabilitySchema,

    sellerName: z.string().min(1).max(255).optional(),
    rating: z.number().min(0).max(5).optional(),
    reviewCount: z.number().int().min(0).max(100_000_000).optional(),
    imageUrl: z.string().max(1024).optional(),

    /** Raw specification table, kept verbatim for re-extraction later. */
    rawAttributes: z.record(z.string(), z.string()).default({}),
    /** Platform-specific extras (sales rank, F-Assured, …). */
    platformData: z.record(z.string(), z.unknown()).default({}),

    fetchedAt: z.date(),
  })
  .superRefine((data, ctx) => {
    // An in-stock listing with no price means a selector broke, not that the
    // item is free. Without this rule the fetch "succeeds" and writes a row
    // with a null price that quietly ends the product's price series.
    if (data.availability === 'IN_STOCK' && data.priceMinor === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['priceMinor'],
        message:
          'An IN_STOCK listing must have a price. A missing price here means the price selector failed.',
      });
    }

    // MRP below the selling price is nonsense and usually means the two
    // selectors were swapped — which would render every discount as negative.
    if (
      data.priceMinor !== undefined &&
      data.mrpMinor !== undefined &&
      data.mrpMinor < data.priceMinor
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['mrpMinor'],
        message: `MRP (${data.mrpMinor}) is below the selling price (${data.priceMinor}); the selectors are probably swapped`,
      });
    }

    // A "99% off" flagship is a scrape error far more often than a real deal.
    // Flagged rather than dropped: the job fails, a human looks, and no
    // fabricated bargain enters the history.
    if (
      data.priceMinor !== undefined &&
      data.mrpMinor !== undefined &&
      data.priceMinor * 20 < data.mrpMinor
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['priceMinor'],
        message:
          'Selling price is under 5% of MRP; refusing to record a probable parse error',
      });
    }

    if (data.url && !/^https?:\/\//i.test(data.url)) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'URL must be absolute http(s)',
      });
    }
  });

export type FetchedProduct = z.infer<typeof FetchedProductSchema>;

/** Shape produced by a parser, before validation. Every field is suspect. */
export type RawFetchedProduct = Partial<
  Omit<FetchedProduct, 'platform' | 'externalId' | 'url' | 'source' | 'fetchedAt'>
> & {
  platform: FetchedProduct['platform'];
  externalId: string;
  url: string;
  source: FetchedProduct['source'];
  fetchedAt: Date;
};

export interface ValidationFailure {
  path: string;
  message: string;
}

export type ValidateResult =
  | { ok: true; data: FetchedProduct }
  | { ok: false; issues: ValidationFailure[] };

/**
 * Validate parser output. Returns a result rather than throwing so the caller
 * can record the specific failure against the scrape job — "which selector
 * broke" is the question you need answered at 2am.
 */
export function validateFetchedProduct(input: unknown): ValidateResult {
  const result = FetchedProductSchema.safeParse(input);

  if (result.success) return { ok: true, data: result.data };

  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  };
}
