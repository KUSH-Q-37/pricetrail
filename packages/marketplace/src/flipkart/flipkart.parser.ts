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
import { extractJsonLdProduct } from './json-ld';
import { FLIPKART_SELECTORS } from './selectors';

type Root = cheerio.CheerioAPI;

function pickText(root: Root, selectors: readonly string[]): string | undefined {
  for (const selector of selectors) {
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
      if (value?.trim()) return value.trim();
    }
  }
  return undefined;
}

/**
 * Recover the MRP when the class-based selectors miss.
 *
 * Scans the attribute-tagged price block for rupee values in document order.
 * The selling price and MRP carry identical classes, so ordinal position is
 * the only thing separating them — but the result is then VALIDATED rather
 * than trusted: a candidate is accepted only if it exceeds the known selling
 * price and sits within a plausible multiple of it.
 *
 * That guard matters. The same page also renders exchange-offer and
 * bank-discount amounts, and a naive "largest rupee value on the page" would
 * happily return one of those as the MRP, producing a fabricated discount on
 * every listing.
 */
function findMrpByOrdinal(root: Root, priceMinor: number | undefined): number | undefined {
  if (!priceMinor) return undefined;

  for (const selector of FLIPKART_SELECTORS.priceBlock) {
    const candidates: number[] = [];

    root(selector).each((_, element) => {
      const text = cleanText(root(element).text());
      if (!text.includes('₹')) return;
      const value = parsePriceToMinor(text);
      if (value !== undefined) candidates.push(value);
    });

    const mrp = candidates.find(
      (value) => value > priceMinor && value <= priceMinor * 3,
    );
    if (mrp !== undefined) return mrp;
  }

  return undefined;
}

/** Specification table plus the highlight bullets above it. */
function extractSpecs(root: Root): Record<string, string> {
  const specs: Record<string, string> = {};

  for (const rowSelector of FLIPKART_SELECTORS.specRows) {
    root(rowSelector).each((_, row) => {
      const cell = root(row);
      let key: string | undefined;
      for (const labelSelector of FLIPKART_SELECTORS.specLabel) {
        const value = cleanText(cell.find(labelSelector).first().text());
        if (value) {
          key = value;
          break;
        }
      }
      let value: string | undefined;
      for (const valueSelector of FLIPKART_SELECTORS.specValue) {
        const found = cleanText(cell.find(valueSelector).first().text());
        if (found) {
          value = found;
          break;
        }
      }
      if (key && value && key.length <= 120 && value.length <= 500 && !(key in specs)) {
        specs[key] = value;
      }
    });
  }

  // Highlights are unlabelled bullets ("8 GB RAM | 256 GB ROM"). Stored under
  // synthetic keys so the attribute extractor still sees the text.
  let highlightIndex = 0;
  for (const selector of FLIPKART_SELECTORS.highlights) {
    root(selector).each((_, item) => {
      const text = cleanText(root(item).text());
      if (text && text.length <= 300) {
        specs[`Highlight ${++highlightIndex}`] = text;
      }
    });
    if (highlightIndex > 0) break;
  }

  return specs;
}

/**
 * Flipkart-specific flags worth keeping but not worth a column.
 * Validated by a Zod schema on write in the API layer.
 */
function extractPlatformData(root: Root, html: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  if (/\bF-?Assured\b/i.test(html) || root('[class*="_3ZgLxJ"]').length > 0) {
    data['fAssured'] = true;
  }
  if (/Flipkart\s+Plus/i.test(html)) {
    data['plusEligible'] = true;
  }

  return data;
}

/**
 * Parse a Flipkart product page.
 *
 * STRATEGY: JSON-LD first, DOM second.
 *
 * Flipkart's CSS classes are build-generated hashes that change on every
 * frontend deploy, so a DOM-first parser needs maintenance every few weeks.
 * Its schema.org JSON-LD, by contrast, is emitted for search engines —
 * Flipkart has a direct commercial incentive to keep it stable and
 * well-formed. Reading that first turns the most fragile part of the scrape
 * into the most stable one.
 *
 * The DOM is still consulted for what JSON-LD omits: MRP, the discount badge,
 * and the specification table.
 *
 * Pure and synchronous — no I/O, so it is fully testable from saved fixtures.
 */
export function parseFlipkartProduct(
  html: string,
  context: ParseContext,
): RawFetchedProduct {
  const root = cheerio.load(html);

  // PerimeterX serves its challenge with HTTP 200, so the status code cannot
  // be used to detect it — the markers must be checked explicitly.
  for (const marker of FLIPKART_SELECTORS.captchaMarkers) {
    if (root(marker).length > 0) throw new BotChallengeError('Flipkart');
  }

  const jsonLd = extractJsonLdProduct(root);
  const specs = extractSpecs(root);

  // --- price ---------------------------------------------------------------
  // JSON-LD wins when present: it is a plain machine-readable number, free of
  // the currency symbols, non-breaking spaces and duplicated nodes that make
  // DOM price extraction error-prone.
  const priceMinor =
    parsePriceToMinor(jsonLd?.price) ??
    parsePriceToMinor(pickText(root, FLIPKART_SELECTORS.price));

  // MRP is not part of Flipkart's JSON-LD, so this one is DOM-only — and it
  // is the field most often lost when the class hashes rotate. Try the legacy
  // class selectors first, then fall back to the attribute-based scan.
  const mrpMinor =
    parsePriceToMinor(pickText(root, FLIPKART_SELECTORS.mrp)) ??
    findMrpByOrdinal(root, priceMinor);

  const discountPercent =
    computeDiscountPercent(priceMinor, mrpMinor) ??
    parseDiscountPercent(pickText(root, FLIPKART_SELECTORS.discount));

  // --- availability --------------------------------------------------------
  let availability = normalizeAvailability(jsonLd?.availability);
  if (availability === 'UNKNOWN') {
    availability = normalizeAvailability(pickText(root, FLIPKART_SELECTORS.availability));
  }
  // Flipkart removes the price block entirely when a product is unavailable.
  if (availability === 'UNKNOWN' && priceMinor === undefined) {
    availability = 'OUT_OF_STOCK';
  }

  // --- identifiers ---------------------------------------------------------
  const gtin = jsonLd?.gtin13 ?? jsonLd?.gtin;
  const ean = gtin?.replace(/\D/g, '');

  const modelFromSpecs = Object.entries(specs).find(([key]) =>
    /^model\s*(number|name)?$/i.test(key),
  )?.[1];

  return {
    platform: 'FLIPKART',
    externalId: context.externalId,
    url: context.url,
    source: context.source,
    fetchedAt: new Date(),

    title: jsonLd?.name ?? pickText(root, FLIPKART_SELECTORS.title),
    brand: jsonLd?.brandName ? cleanText(jsonLd.brandName).slice(0, 120) : undefined,
    modelNumber: modelFromSpecs ? cleanText(modelFromSpecs).slice(0, 120) : undefined,
    mpn: jsonLd?.mpn ? cleanText(jsonLd.mpn).slice(0, 120) : undefined,
    ean: ean && ean.length >= 8 && ean.length <= 14 ? ean : undefined,

    currency: jsonLd?.priceCurrency ?? 'INR',
    priceMinor,
    mrpMinor,
    discountPercent,
    availability,

    sellerName:
      jsonLd?.sellerName ?? pickText(root, FLIPKART_SELECTORS.seller),
    rating:
      parseRating(jsonLd?.ratingValue) ??
      parseRating(pickText(root, FLIPKART_SELECTORS.rating)),
    reviewCount:
      parseReviewCount(jsonLd?.reviewCount) ??
      parseReviewCount(pickText(root, FLIPKART_SELECTORS.reviewCount)),
    imageUrl:
      jsonLd?.image ?? pickAttr(root, FLIPKART_SELECTORS.image, ['src', 'data-src']),

    rawAttributes: specs,
    platformData: extractPlatformData(root, html),
  };
}
