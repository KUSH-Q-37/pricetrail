/**
 * Searching a marketplace for candidate products.
 *
 * Distinct from fetching. A fetch answers "what is the price of this known
 * product"; a search answers "which products on this marketplace might be the
 * one I am holding". Counterpart discovery — starting from an Amazon listing
 * and finding its Flipkart equivalent — needs the second, and the adapters
 * only ever had the first.
 *
 * Unavailability is a RESULT, not an exception
 * -------------------------------------------
 * `available: false` is the normal, expected answer when no search source is
 * configured, and it is deliberately not a thrown error. Discovery is a
 * best-effort enrichment of a product the user already asked for: if the
 * opposite marketplace cannot be searched, the original listing must still be
 * returned and still be tracked. Throwing would tempt callers into a catch
 * that cannot distinguish "no credentials" from "the search failed", and the
 * difference matters — one is retryable, the other is a configuration fact.
 */

/**
 * A possible match found on a marketplace.
 *
 * Deliberately thin. This is a candidate, not a product: it carries only what
 * a search response reliably returns and what the matching engine needs to
 * score it. Anything richer is fetched properly once a candidate is accepted.
 */
export interface ProductSearchCandidate {
  externalId: string;
  url: string;
  title: string;
  brand?: string;
  priceMinor?: number;
  imageUrl?: string;

  // Identifier fields feed matching Layer 1, which is the only layer that can
  // be conclusive. A search that returns an EAN is worth far more than one
  // that returns a longer title.
  ean?: string;
  upc?: string;
  modelNumber?: string;
  mpn?: string;
}

export interface ProductSearchResult {
  /** False when no search source is configured for this marketplace. */
  available: boolean;
  /** Why searching was not possible, when `available` is false. */
  reason?: string;
  /**
   * Whether a later attempt could succeed.
   *
   * Missing credentials are not retryable — retrying changes nothing until
   * someone configures them. A spent quota or a network failure is.
   */
  retryable?: boolean;
  candidates: ProductSearchCandidate[];
}

export interface MarketplaceSearch {
  /**
   * Find candidate products matching a free-text query.
   *
   * Implementations must not throw for want of configuration — return
   * `{ available: false, retryable: false, candidates: [] }` instead.
   *
   * `page` is 1-based and exists for catalogue discovery, which walks a query
   * far deeper than counterpart matching ever does. Counterpart discovery only
   * ever wants the first page: relevance falls off a cliff after it, and a
   * match that is not in the top handful is not a match.
   */
  searchProducts(
    query: string,
    limit?: number,
    page?: number,
  ): Promise<ProductSearchResult>;
}

/** The answer when a marketplace has no usable search source. */
export function searchUnavailable(reason: string, retryable = false): ProductSearchResult {
  return { available: false, reason, retryable, candidates: [] };
}
