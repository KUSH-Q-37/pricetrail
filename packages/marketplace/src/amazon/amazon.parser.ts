import * as cheerio from 'cheerio';

import { BotChallengeError } from '../errors';
import type { ParseContext } from '../fetch/parse-function';
import type { RawFetchedProduct } from '../product-data.schema';
import { normalizeAvailability } from '../shared/availability';
import {
  computeDiscountPercent,
  parseDiscountPercent,
  parsePriceToMinor,
} from '../shared/price';
import { cleanText, parseRating, parseReviewCount } from '../shared/text';
import { AMAZON_SELECTORS } from './selectors';

// BotChallengeError now lives in ../errors, since both platform parsers raise
// it. Import it from there (or from the package root).

type Root = cheerio.CheerioAPI;

/** First selector that yields non-empty text. */
function pickText(root: Root, selectors: readonly string[]): string | undefined {
  for (const selector of selectors) {
    // `.first()` matters: `.a-price .a-offscreen` matches several nodes on a
    // page with multiple offers, and `.text()` over the set concatenates them.
    const value = cleanText(root(selector).first().text());
    if (value) return value;
  }
  return undefined;
}

function pickAttr(
  root: Root,
  selectors: readonly string[],
  attributes: string[],
): string | undefined {
  for (const selector of selectors) {
    const element = root(selector).first();
    if (element.length === 0) continue;
    for (const attribute of attributes) {
      const value = element.attr(attribute);
      if (value && value.trim()) return value.trim();
    }
  }
  return undefined;
}

/**
 * Brand text arrives as "Visit the Apple Store" or "Brand: Apple".
 * Stripping the boilerplate is what makes Layer 1 brand comparison work — a
 * brand veto comparing "Visit the Apple Store" to "Apple" would reject every
 * genuine cross-platform match.
 */
function cleanBrand(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const value = cleanText(input)
    .replace(/^visit\s+the\s+/i, '')
    .replace(/\s+store$/i, '')
    .replace(/^brand[:\s]+/i, '')
    .replace(/^by\s+/i, '')
    .trim();
  return value.length > 0 && value.length <= 120 ? value : undefined;
}

/** Merge the several shapes Amazon uses for specification tables. */
function extractSpecs(root: Root): Record<string, string> {
  const specs: Record<string, string> = {};

  for (const selector of AMAZON_SELECTORS.specTables) {
    root(selector).each((_, row) => {
      const key = cleanText(root(row).find('th, .a-span3, .label').first().text());
      const value = cleanText(root(row).find('td, .a-span9, .value').first().text());
      if (key && value && key.length <= 120 && value.length <= 500) {
        specs[key] = value;
      }
    });
  }

  for (const selector of AMAZON_SELECTORS.detailBullets) {
    root(selector).each((_, item) => {
      const text = cleanText(root(item).text());
      const separator = text.indexOf(':');
      if (separator > 0 && separator < 120) {
        const key = cleanText(text.slice(0, separator));
        const value = cleanText(text.slice(separator + 1));
        if (key && value && value.length <= 500 && !(key in specs)) {
          specs[key] = value;
        }
      }
    });
  }

  return specs;
}

function findSpec(
  specs: Record<string, string>,
  patterns: RegExp[],
): string | undefined {
  for (const [key, value] of Object.entries(specs)) {
    if (patterns.some((pattern) => pattern.test(key))) return value;
  }
  return undefined;
}

/**
 * Parse an Amazon product page into unvalidated fields.
 *
 * Pure and synchronous: HTML in, plain object out, no I/O. That is what makes
 * the whole parsing surface testable from saved fixtures with no network and
 * no browser — and therefore testable in CI, deterministically, on every
 * commit.
 *
 * The result is NOT trusted. It goes to `validateFetchedProduct` next.
 */
export function parseAmazonProduct(
  html: string,
  context: ParseContext,
): RawFetchedProduct {
  const root = cheerio.load(html);

  // Check for a bot challenge before anything else. A challenge page still
  // has a <title> and would otherwise parse into a product called
  // "Robot Check" with no price — which the schema would reject, but with a
  // misleading reason that sends you hunting for a broken selector.
  for (const marker of AMAZON_SELECTORS.captchaMarkers) {
    if (root(marker).length > 0) throw new BotChallengeError('Amazon');
  }

  const specs = extractSpecs(root);

  const priceMinor = parsePriceToMinor(pickText(root, AMAZON_SELECTORS.price));
  const mrpMinor = parsePriceToMinor(pickText(root, AMAZON_SELECTORS.mrp));

  const availabilityText = pickText(root, AMAZON_SELECTORS.availability);
  let availability = normalizeAvailability(availabilityText);

  // An explicit out-of-stock block outranks whatever the availability text
  // said — Amazon sometimes leaves stale delivery copy on a dead listing.
  if (availability === 'UNKNOWN' || availability === 'IN_STOCK') {
    for (const marker of AMAZON_SELECTORS.unavailableMarkers) {
      if (root(marker).length > 0 && /unavailable|out of stock/i.test(cleanText(root(marker).text()))) {
        availability = 'OUT_OF_STOCK';
        break;
      }
    }
  }

  // A page with no price at all and no availability signal is out of stock,
  // not "unknown" — Amazon removes the buy box entirely in that case.
  if (availability === 'UNKNOWN' && priceMinor === undefined) {
    availability = 'OUT_OF_STOCK';
  }

  // Prefer the computed discount over the badge: the badge is a marketing
  // string and is occasionally stale relative to the displayed prices.
  const discountPercent =
    computeDiscountPercent(priceMinor, mrpMinor) ??
    parseDiscountPercent(pickText(root, AMAZON_SELECTORS.discount));

  const modelNumber = findSpec(specs, [
    /item\s*model\s*number/i,
    /^model$/i,
    /model\s*name/i,
  ]);

  const ean = findSpec(specs, [/^ean$/i, /ean\b/i])?.replace(/\D/g, '');
  const upc = findSpec(specs, [/^upc$/i])?.replace(/\D/g, '');

  return {
    platform: 'AMAZON',
    externalId: context.externalId,
    url: context.url,
    source: context.source,
    fetchedAt: new Date(),

    title: pickText(root, AMAZON_SELECTORS.title),
    brand: cleanBrand(pickText(root, AMAZON_SELECTORS.brand)),
    modelNumber: modelNumber ? cleanText(modelNumber).slice(0, 120) : undefined,
    ean: ean && ean.length >= 8 && ean.length <= 14 ? ean : undefined,
    upc: upc && upc.length === 12 ? upc : undefined,

    currency: 'INR',
    priceMinor,
    mrpMinor,
    discountPercent,
    availability,

    sellerName: pickText(root, AMAZON_SELECTORS.seller),
    rating: parseRating(
      pickAttr(root, AMAZON_SELECTORS.rating, ['title', 'aria-label']) ??
        pickText(root, AMAZON_SELECTORS.rating),
    ),
    reviewCount: parseReviewCount(pickText(root, AMAZON_SELECTORS.reviewCount)),
    imageUrl: pickAttr(root, AMAZON_SELECTORS.image, ['data-old-hires', 'src']),

    rawAttributes: specs,
    platformData: {},
  };
}
