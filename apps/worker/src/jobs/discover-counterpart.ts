import { Platform, ProductStatus, type PrismaClient } from '@pricetrail/database';
import type { MarketplaceAdapter, ProductSearchResult } from '@pricetrail/marketplace';

export interface DiscoveryResult {
  /** False when the opposite marketplace has no usable search source. */
  searched: boolean;
  reason?: string;
  retryable?: boolean;
  /** Candidate listings created and queued for fetching. */
  created: string[];
  skipped?: string;
}

/**
 * How many search hits to take seriously.
 *
 * Relevance ranking falls off quickly, and every candidate costs a product
 * row, a fetch and a matching pass. Three is enough to survive the correct
 * answer being second or third without turning one search into a crawl.
 */
const MAX_CANDIDATES = 3;

/**
 * Given a listing on one marketplace, find its counterpart on the other.
 *
 * Why discovery is needed at all
 * ------------------------------
 * The matching engine can only score listings that already exist locally, so
 * a user who pastes an Amazon URL gets no comparison until somebody happens to
 * paste the matching Flipkart URL. Waiting for that coincidence is not a
 * product. This closes the loop: search the opposite marketplace, create the
 * candidates it returns, and let the existing matcher decide.
 *
 * What this deliberately does NOT do
 * ----------------------------------
 * It does not attach anything to the source product. Candidates are created
 * under their own products and left for the matcher, whose veto rules exist
 * precisely because search relevance will cheerfully return a phone case for a
 * phone. Merging happens only on AUTO_CONFIRMED, in merge-products.ts.
 *
 * Candidates are also created with trackingEnabled = false. A search returning
 * three guesses must not enrol three products in daily collection forever —
 * that is how "track what users search" becomes "track a slowly growing pile
 * of wrong answers". Tracking is switched on for a candidate only once it is
 * confirmed to be the same product.
 *
 * Failure is never fatal to the caller. The user asked about the product they
 * pasted; a marketplace that cannot be searched should cost them a comparison,
 * not their result.
 */
export async function discoverCounterpart(
  prisma: PrismaClient,
  getAdapter: (platform: Platform) => MarketplaceAdapter & {
    searchProducts?: (query: string, limit?: number) => Promise<ProductSearchResult>;
  },
  listingId: string,
): Promise<DiscoveryResult> {
  const listing = await prisma.marketplaceListing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      platform: true,
      title: true,
      brand: true,
      modelNumber: true,
      productId: true,
      product: { select: { status: true, listings: { select: { platform: true } } } },
    },
  });

  if (!listing) {
    return { searched: false, created: [], skipped: 'listing not found' };
  }

  // Nothing to search for until the listing has been fetched — a PENDING
  // placeholder title is "Flipkart product WMNHYX2BMWTBFFMS", which as a query
  // returns either nothing or noise.
  if (listing.product.status !== ProductStatus.READY) {
    return { searched: false, created: [], skipped: 'source listing not fetched yet' };
  }

  const target: Platform =
    listing.platform === Platform.AMAZON ? Platform.FLIPKART : Platform.AMAZON;

  if (listing.product.listings.some((l) => l.platform === target)) {
    return { searched: false, created: [], skipped: 'counterpart already present' };
  }

  const adapter = getAdapter(target);
  if (typeof adapter.searchProducts !== 'function') {
    return { searched: false, created: [], reason: 'adapter has no search', retryable: false };
  }

  // Brand first, then the title. The brand is the single most discriminating
  // token and search engines weight leading terms; the title is truncated
  // because a 200-character Indian marketplace title is mostly marketing and
  // dilutes the query rather than sharpening it.
  const query = [listing.brand, listing.title].filter(Boolean).join(' ').slice(0, 120);

  const result = await adapter.searchProducts(query, MAX_CANDIDATES);

  if (!result.available) {
    return {
      searched: false,
      created: [],
      reason: result.reason,
      retryable: result.retryable ?? false,
    };
  }

  const created: string[] = [];

  for (const candidate of result.candidates.slice(0, MAX_CANDIDATES)) {
    // Already known: leave it alone. It may already be matched, or be under a
    // product a user cares about, and re-creating it would violate the
    // platform+external_id uniqueness that makes repeat searches free.
    const existing = await prisma.marketplaceListing.findUnique({
      where: { platform_externalId: { platform: target, externalId: candidate.externalId } },
      select: { id: true },
    });
    if (existing) continue;

    const normalized = candidate.title.toLowerCase().replace(/\s+/g, ' ').trim();

    const product = await prisma.product.create({
      data: {
        displayTitle: candidate.title.slice(0, 512),
        normalizedTitle: normalized.slice(0, 512),
        brand: candidate.brand?.slice(0, 120) ?? null,
        status: ProductStatus.PENDING,
        listings: {
          create: {
            platform: target,
            externalId: candidate.externalId,
            url: candidate.url,
            title: candidate.title.slice(0, 512),
            normalizedTitle: normalized.slice(0, 512),
            brand: candidate.brand?.slice(0, 120) ?? null,
            modelNumber: candidate.modelNumber?.slice(0, 120) ?? null,
            mpn: candidate.mpn?.slice(0, 120) ?? null,
            ean: candidate.ean?.slice(0, 32) ?? null,
            upc: candidate.upc?.slice(0, 32) ?? null,
            imageUrl: candidate.imageUrl?.slice(0, 1024) ?? null,
            // Off until confirmed. See the note above.
            trackingEnabled: false,
          },
        },
      },
      include: { listings: { select: { id: true } } },
    });

    const createdListing = product.listings[0];
    if (createdListing) created.push(createdListing.id);
  }

  return { searched: true, created };
}
