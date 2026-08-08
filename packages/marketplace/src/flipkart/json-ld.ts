import type * as cheerio from 'cheerio';

/**
 * schema.org Product extracted from embedded JSON-LD.
 * Every field optional — this is untrusted input, not a contract.
 */
export interface JsonLdProduct {
  name?: string;
  sku?: string;
  gtin13?: string;
  gtin?: string;
  mpn?: string;
  image?: string;
  brandName?: string;
  price?: string;
  priceCurrency?: string;
  availability?: string;
  sellerName?: string;
  ratingValue?: string;
  reviewCount?: string;
}

type Json = Record<string, unknown>;

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** `@type` may be a string or an array of strings. */
function hasType(node: Json, type: string): boolean {
  const raw = node['@type'];
  if (typeof raw === 'string') return raw.toLowerCase() === type.toLowerCase();
  if (Array.isArray(raw)) {
    return raw.some((t) => typeof t === 'string' && t.toLowerCase() === type.toLowerCase());
  }
  return false;
}

/**
 * Walk an arbitrarily nested JSON-LD document collecting every object node.
 *
 * A page's JSON-LD is rarely one flat Product. Flipkart emits several blocks
 * (BreadcrumbList, Organization, WebPage, Product), any of which may be an
 * array at the top level or wrapped in `@graph`. Taking `JSON.parse(...)[0]`
 * or assuming the first block is the Product silently picks up the breadcrumb
 * trail and yields a "product" named after a category.
 */
function collectNodes(value: unknown, out: Json[] = [], depth = 0): Json[] {
  if (depth > 8 || value === null || typeof value !== 'object') return out;

  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out, depth + 1);
    return out;
  }

  const node = value as Json;
  out.push(node);

  for (const key of ['@graph', 'itemListElement', 'mainEntity', 'hasPart']) {
    if (key in node) collectNodes(node[key], out, depth + 1);
  }

  return out;
}

/** Offer nodes carry the price; may be Offer or AggregateOffer, singular or array. */
function pickOffer(product: Json): Json | undefined {
  const offers = product['offers'];
  const candidates = collectNodes(offers);

  return (
    candidates.find((node) => hasType(node, 'Offer')) ??
    candidates.find((node) => hasType(node, 'AggregateOffer')) ??
    candidates.find((node) => 'price' in node || 'lowPrice' in node)
  );
}

/**
 * Extract the Product node from a page's JSON-LD blocks.
 *
 * Malformed blocks are skipped rather than fatal: marketplaces regularly emit
 * one broken block alongside several valid ones, and throwing on the first
 * parse error would discard perfectly good data.
 */
export function extractJsonLdProduct(
  root: cheerio.CheerioAPI,
): JsonLdProduct | undefined {
  const scripts = root('script[type="application/ld+json"]');

  for (let index = 0; index < scripts.length; index++) {
    const raw = root(scripts[index]).contents().text().trim();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const product = collectNodes(parsed).find((node) => hasType(node, 'Product'));
    if (!product) continue;

    const offer = pickOffer(product);
    const brand = collectNodes(product['brand']).find(
      (node) => 'name' in node,
    );
    const seller = offer ? collectNodes(offer['seller']).find((n) => 'name' in n) : undefined;
    const rating = collectNodes(product['aggregateRating']).find(
      (node) => 'ratingValue' in node,
    );

    const image = product['image'];
    const imageUrl = Array.isArray(image)
      ? asString(image[0])
      : asString(image) ??
        asString(collectNodes(image).find((n) => 'url' in n)?.['url']);

    return {
      name: asString(product['name']),
      sku: asString(product['sku']),
      gtin13: asString(product['gtin13']),
      gtin: asString(product['gtin']),
      mpn: asString(product['mpn']),
      image: imageUrl,
      brandName: asString(brand?.['name']) ?? asString(product['brand']),
      price: asString(offer?.['price']) ?? asString(offer?.['lowPrice']),
      priceCurrency: asString(offer?.['priceCurrency']),
      availability: asString(offer?.['availability']),
      sellerName: asString(seller?.['name']),
      ratingValue: asString(rating?.['ratingValue']),
      reviewCount:
        asString(rating?.['reviewCount']) ?? asString(rating?.['ratingCount']),
    };
  }

  return undefined;
}
