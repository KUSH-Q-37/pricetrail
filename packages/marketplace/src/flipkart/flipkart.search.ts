import type { ProductSearchCandidate } from '../search';

/**
 * Extract candidate products from a Flipkart search-results page.
 *
 * Scope, deliberately narrow
 * --------------------------
 * This reads exactly two things per result: the FSN and the product URL. It
 * does NOT try to parse prices, ratings, brands or specifications out of the
 * results grid, even though they are visibly there.
 *
 * That restraint is the point. The grid is personalised, ad-injected and
 * carries no JSON-LD, so anything scraped from it is materially less reliable
 * than the same field read from the product page — and every candidate found
 * here is fetched properly through the normal pipeline before it can influence
 * anything. Parsing prices here would add a second, worse source of truth for
 * a number the product already collects correctly.
 *
 * So a candidate is an ADDRESS, not a product.
 *
 * The title is provisional
 * ------------------------
 * It is reconstructed from the URL slug — "apple-iphone-15-pro-blue-titanium-
 * 256-gb" becomes "apple iphone 15 pro blue titanium 256 gb". Lossy, lowercase,
 * and good enough for a placeholder row that will be overwritten by the real
 * title within seconds. It is never shown to a user as a final value, and the
 * matcher does not run until the proper fetch has happened.
 */

/**
 * Matches an anchor carrying both the product path and its FSN.
 *
 * Anchored on `?pid=` rather than on any class name. Flipkart rotates its class
 * hashes freely — it did so mid-project and broke every product-page selector
 * at once — but it cannot change the shape of its own product URLs without
 * breaking every inbound link it has ever published.
 */
const RESULT_HREF = /href="(\/[a-z0-9-]+\/p\/itm[a-z0-9]+\?pid=([A-Z0-9]{16})[^"]*)"/gi;

/** Flipkart FSNs are exactly 16 uppercase alphanumerics. */
const FSN = /^[A-Z0-9]{16}$/;

function titleFromSlug(path: string): string {
  const slug = path.split('/p/')[0]?.replace(/^\//, '') ?? '';
  return slug.replace(/-/g, ' ').trim();
}

export function parseFlipkartSearchResults(
  html: string,
  limit: number,
): ProductSearchCandidate[] {
  const seen = new Set<string>();
  const candidates: ProductSearchCandidate[] = [];

  for (const match of html.matchAll(RESULT_HREF)) {
    const path = match[1];
    const fsn = match[2];
    if (!path || !fsn || !FSN.test(fsn)) continue;

    // The same product appears several times per page — grid tile, carousel,
    // "similar items". Dedupe on the FSN, which is the identity the rest of
    // the system keys listings on.
    if (seen.has(fsn)) continue;
    seen.add(fsn);

    const title = titleFromSlug(path);
    // A slug that yields nothing usable is a navigational link, not a product.
    if (title.length < 3) continue;

    candidates.push({
      externalId: fsn,
      url: `https://www.flipkart.com${path}`,
      title,
    });

    if (candidates.length >= limit) break;
  }

  return candidates;
}
