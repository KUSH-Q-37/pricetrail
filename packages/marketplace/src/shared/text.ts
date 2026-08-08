/**
 * Collapse whitespace and strip zero-width characters.
 *
 * Marketplace HTML is full of newlines, tabs, non-breaking spaces and the
 * occasional zero-width joiner. Left in place they defeat exact-match
 * comparisons and make trigram similarity noisy.
 */
export function cleanText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/[​-‍﻿]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical form used for trigram search and as a matching-layer input.
 *
 * Lowercased, punctuation removed, whitespace collapsed. This is what
 * `products.normalized_title` and `marketplace_listings.normalized_title`
 * store, and what the GIN trigram index is built on — never search the display
 * title directly.
 */
export function normalizeTitle(input: string | null | undefined): string {
  return cleanText(input)
    .toLowerCase()
    // Keep alphanumerics and spaces. Hyphens and slashes inside model numbers
    // (GL-S292RPZX, WH-1000XM5) become spaces rather than vanishing, so the
    // tokens stay separable instead of fusing into one long string.
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse a star rating, clamped to the 0-5 scale both marketplaces use. */
export function parseRating(input: string | null | undefined): number | undefined {
  if (!input) return undefined;
  const match = /(\d(?:\.\d)?)\s*(?:out\s+of\s+5|\/\s*5)?/i.exec(cleanText(input));
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 5 ? value : undefined;
}

/** Parse "3,421 ratings" / "1.2K reviews" into an integer count. */
export function parseReviewCount(input: string | null | undefined): number | undefined {
  if (!input) return undefined;
  const text = cleanText(input);

  const scaled = /(\d+(?:\.\d+)?)\s*([KkMm])\b/.exec(text);
  if (scaled?.[1] && scaled[2]) {
    const multiplier = scaled[2].toLowerCase() === 'k' ? 1_000 : 1_000_000;
    return Math.round(Number(scaled[1]) * multiplier);
  }

  const plain = /([\d,]+)/.exec(text);
  if (!plain?.[1]) return undefined;
  const value = Number(plain[1].replace(/,/g, ''));
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
