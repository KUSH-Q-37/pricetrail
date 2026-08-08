import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseAmazonProduct } from '../src/amazon/amazon.parser';
import { BotChallengeError } from '../src/errors';
import { parseFlipkartProduct } from '../src/flipkart/flipkart.parser';
import { validateFetchedProduct } from '../src/product-data.schema';
import { normalizeAttributes } from '../src/shared/attributes';

const fixture = (platform: string, name: string): string =>
  readFileSync(join(__dirname, 'fixtures', platform, `${name}.html`), 'utf8');

const AMAZON_CTX = {
  externalId: 'B0CHX1W1XY',
  url: 'https://www.amazon.in/dp/B0CHX1W1XY',
  source: 'SCRAPE' as const,
};
const FLIPKART_CTX = {
  externalId: 'MOBGTAGPTB3VS24W',
  url: 'https://www.flipkart.com/p/itm123?pid=MOBGTAGPTB3VS24W',
  source: 'SCRAPE' as const,
};

describe('Amazon parser', () => {
  it('extracts a complete in-stock product', () => {
    const raw = parseAmazonProduct(fixture('amazon', 'iphone-in-stock'), AMAZON_CTX);

    expect(raw.title).toBe('Apple iPhone 15 Pro (256 GB) - Natural Titanium');
    // "Visit the Apple Store" -> "Apple". Without this the brand veto would
    // reject every genuine cross-platform match.
    expect(raw.brand).toBe('Apple');
    expect(raw.priceMinor).toBe(13499900);
    expect(raw.mrpMinor).toBe(14990000);
    expect(raw.discountPercent).toBe(10);
    expect(raw.availability).toBe('IN_STOCK');
    expect(raw.sellerName).toBe('Appario Retail Private Ltd');
    expect(raw.rating).toBe(4.6);
    expect(raw.reviewCount).toBe(3421);
    expect(raw.ean).toBe('0195949022029');
    expect(raw.imageUrl).toContain('_SL1500_');
    expect(validateFetchedProduct(raw).ok).toBe(true);
  });

  it('handles legacy priceblock markup and limited stock', () => {
    const raw = parseAmazonProduct(fixture('amazon', 'fridge-limited-stock'), AMAZON_CTX);

    expect(raw.priceMinor).toBe(2899000);
    expect(raw.mrpMinor).toBe(3799000);
    expect(raw.availability).toBe('LIMITED_STOCK');
    expect(raw.brand).toBe('LG');

    const attributes = normalizeAttributes(raw.rawAttributes ?? {});
    expect(attributes.capacity_l).toBe(260);
    expect(attributes.star_rating).toBe(3);
  });

  it('accepts an out-of-stock listing with no price', () => {
    // A legitimate observation, not a failure.
    const raw = parseAmazonProduct(fixture('amazon', 'out-of-stock'), AMAZON_CTX);

    expect(raw.priceMinor).toBeUndefined();
    expect(raw.availability).toBe('OUT_OF_STOCK');
    expect(validateFetchedProduct(raw).ok).toBe(true);
  });

  it('raises BotChallengeError before parsing a captcha page', () => {
    // Detected up front: a challenge page still has a <title> and would
    // otherwise parse into a "product" called "Robot Check", failing
    // validation for a misleading reason.
    expect(() => parseAmazonProduct(fixture('amazon', 'captcha'), AMAZON_CTX)).toThrow(
      BotChallengeError,
    );
  });
});

describe('Flipkart parser — JSON-LD first, DOM second', () => {
  it('picks the Product block, not the BreadcrumbList', () => {
    // The Product block is SECOND on the page. Taking [0] names the product
    // after a category.
    const raw = parseFlipkartProduct(fixture('flipkart', 'iphone-jsonld'), FLIPKART_CTX);

    expect(raw.title).toBe('APPLE iPhone 15 Pro (Natural Titanium, 256 GB)');
    expect(raw.brand).toBe('APPLE');
    expect(raw.priceMinor).toBe(13290000);
    // MRP is absent from Flipkart's JSON-LD, so this one comes from the DOM.
    expect(raw.mrpMinor).toBe(14990000);
    expect(raw.discountPercent).toBe(11);
    expect(raw.availability).toBe('IN_STOCK');
    expect(raw.ean).toBe('0195949022029');
    expect(raw.platformData?.['fAssured']).toBe(true);
    expect(validateFetchedProduct(raw).ok).toBe(true);
  });

  it('SURVIVES a frontend redeploy that changes every class hash', () => {
    // The scenario this architecture exists for. Flipkart ships
    // build-generated class names that change without notice; the schema.org
    // block is emitted for search engines and stays stable.
    const raw = parseFlipkartProduct(fixture('flipkart', 'hashed-classes-changed'), {
      ...FLIPKART_CTX,
      externalId: 'ACCGXYZ7HFGHZZZZ',
    });

    expect(raw.title).toBe('SONY WH-1000XM5 Bluetooth Headset (Black, On the Ear)');
    expect(raw.priceMinor).toBe(2699000);
    expect(raw.brand).toBe('SONY');
    expect(raw.reviewCount).toBe(8934);
    // MRP is DOM-only, so it is genuinely lost — degraded, not broken.
    expect(raw.mrpMinor).toBeUndefined();
    expect(validateFetchedProduct(raw).ok).toBe(true);
  });

  it('falls back to the DOM when no JSON-LD exists', () => {
    const raw = parseFlipkartProduct(fixture('flipkart', 'no-jsonld-dom-only'), FLIPKART_CTX);

    expect(raw.priceMinor).toBe(2849000);
    expect(raw.mrpMinor).toBe(3799000);
    expect(raw.rating).toBe(4.2);
    expect(normalizeAttributes(raw.rawAttributes ?? {}).capacity_l).toBe(260);
  });

  it('detects a PerimeterX challenge served with HTTP 200', () => {
    // The status code cannot detect this — only the markers can.
    expect(() =>
      parseFlipkartProduct(fixture('flipkart', 'perimeterx-challenge'), FLIPKART_CTX),
    ).toThrow(BotChallengeError);
  });

  it('treats a sold-out listing with no price as valid', () => {
    const raw = parseFlipkartProduct(fixture('flipkart', 'sold-out'), FLIPKART_CTX);

    expect(raw.availability).toBe('OUT_OF_STOCK');
    expect(raw.priceMinor).toBeUndefined();
    expect(validateFetchedProduct(raw).ok).toBe(true);
  });
});

/**
 * The boundary. Price history is append-only and never edited, so a bad value
 * written today is visible in every chart forever. Better to record NOTHING
 * than a number we are not sure about.
 */
describe('boundary schema — the failures that matter', () => {
  const base = {
    platform: 'AMAZON' as const,
    externalId: 'B0TEST1234',
    url: 'https://www.amazon.in/dp/B0TEST1234',
    source: 'SCRAPE' as const,
    fetchedAt: new Date(),
    title: 'Test Product',
    availability: 'IN_STOCK' as const,
    rawAttributes: {},
    platformData: {},
    currency: 'INR',
  };

  it('REJECTS an in-stock listing with no price', () => {
    // THE most important rule. This is the exact shape of Amazon shipping a
    // layout change: page loads, product is live, price selector silently
    // stops matching. Without this the fetch "succeeds" and quietly ends the
    // product's price series.
    const raw = parseAmazonProduct(fixture('amazon', 'broken-price-selector'), AMAZON_CTX);
    const result = validateFetchedProduct(raw);

    expect(raw.title).toBe('Samsung Galaxy S24 Ultra 5G (512 GB) Titanium Grey');
    expect(raw.priceMinor).toBeUndefined();
    expect(raw.availability).toBe('IN_STOCK');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === 'priceMinor')).toBe(true);
    }
  });

  it.each([
    ['swapped price/MRP', { priceMinor: 10000, mrpMinor: 5000 }],
    ['implausible 99% discount', { priceMinor: 1000, mrpMinor: 500000 }],
    ['float price', { priceMinor: 1299.99 }],
    ['negative price', { priceMinor: -500 }],
    ['relative URL', { priceMinor: 1000, url: '/dp/B0TEST1234' }],
    ['1-character title', { priceMinor: 1000, title: 'X' }],
    ['malformed EAN', { priceMinor: 1000, ean: 'ABC' }],
  ])('rejects %s', (_name, override) => {
    expect(validateFetchedProduct({ ...base, ...override }).ok).toBe(false);
  });

  it('accepts a well-formed observation', () => {
    expect(validateFetchedProduct({ ...base, priceMinor: 1000, mrpMinor: 1500 }).ok).toBe(
      true,
    );
  });
});
