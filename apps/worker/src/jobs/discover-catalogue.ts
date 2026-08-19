import { Prisma, ProductStatus, type PrismaClient } from '@pricetrail/database';
import type { MarketplaceSearch } from '@pricetrail/marketplace';

/**
 * Enrol products nobody has searched for.
 *
 * Until this existed, the tracked set grew only when a person pasted a URL.
 * That makes the dataset a function of traffic, which on a new site means it
 * barely grows at all — 17 products after twelve days. This walks Flipkart's
 * search results for a list of broad seed queries and enrols everything it
 * finds, so the catalogue builds itself.
 *
 * WHY THERE IS A CAP, AND WHY IT IS NOT OPTIONAL
 * ----------------------------------------------
 * "Track everything" is not a setting that can be turned up. Flipkart lists
 * on the order of 150 million items; one price point per product per day makes
 * that 150M rows a day, against a 500 MB Supabase free tier.
 *
 * Measured on real data: price_points costs about 550 bytes per row at low
 * volume and settles nearer 300 once partitions fill. Retention keeps 15
 * months, so each tracked product eventually occupies roughly
 *
 *     456 days x 300 bytes ~= 137 KB
 *
 * Budgeting ~350 MB of a 500 MB database for price history leaves room for
 * about 2 500 products. That is the default. Raise it when the database is
 * bigger, not before — the failure mode of exceeding it is a full disk, which
 * stops the daily sweep writing ANY prices, including for the products people
 * actually searched for.
 *
 * FLIPKART ONLY
 * -------------
 * Amazon.in answers every scrape with a bot challenge, so there is no way to
 * discover Amazon products without the Creators API. Once those credentials
 * exist, counterpart discovery already links Amazon listings to the Flipkart
 * products found here — this job does not need to change.
 */

export interface DiscoverCatalogueOptions {
  prisma: PrismaClient;
  /** Flipkart. Passed as the narrow interface it actually uses. */
  search: MarketplaceSearch;
  /** Broad queries to walk. Each yields ~24 products per page. */
  seeds: string[];
  /** Hard ceiling on tracked listings. See the note above before raising it. */
  maxListings: number;
  /** How deep to walk each seed in one run. */
  pagesPerSeed: number;
  /** Politeness delay between page fetches. */
  pageDelayMs: number;
  logger: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
  };
}

export interface DiscoverCatalogueResult {
  /** Listings tracked before this run. */
  trackedBefore: number;
  /** Newly enrolled in this run. */
  enrolled: number;
  /** Seen but already known — the normal majority on a second run. */
  alreadyKnown: number;
  /** Search pages actually fetched. */
  pagesFetched: number;
  /** True when the cap stopped the run early. */
  capReached: boolean;
}

/**
 * Default seeds: broad category words rather than specific models.
 *
 * A generic term returns a wide spread of brands and price points, which is
 * what a price-comparison dataset wants. Seeding with "iphone 15" would return
 * forty near-identical listings and teach the matcher nothing.
 */
export const DEFAULT_DISCOVERY_SEEDS = [
  'smartphone',
  'laptop',
  'headphones',
  'smartwatch',
  'television',
  'refrigerator',
  'washing machine',
  'air conditioner',
  'tablet',
  'camera',
  'shoes',
  'backpack',
];

/** Free-tier safe. See the storage note above. */
export const DEFAULT_MAX_TRACKED_LISTINGS = 2500;

export async function discoverCatalogue(
  options: DiscoverCatalogueOptions,
): Promise<DiscoverCatalogueResult> {
  const { prisma, search, seeds, maxListings, pagesPerSeed, pageDelayMs, logger } =
    options;

  const trackedBefore = await prisma.marketplaceListing.count({
    where: { trackingEnabled: true },
  });

  const result: DiscoverCatalogueResult = {
    trackedBefore,
    enrolled: 0,
    alreadyKnown: 0,
    pagesFetched: 0,
    capReached: false,
  };

  // The cheap early exit. Once the catalogue is full this job costs one COUNT
  // per run and nothing else, which is what makes it safe to schedule often.
  if (trackedBefore >= maxListings) {
    result.capReached = true;
    logger.info('catalogue discovery skipped: at capacity', {
      trackedBefore,
      maxListings,
    });
    return result;
  }

  let budget = maxListings - trackedBefore;

  // Seeds are walked breadth-first — page 1 of every seed, then page 2 of
  // every seed. Depth-first would spend the entire budget on smartphones
  // before reaching televisions, and a run that is interrupted (deploy,
  // restart, cap) would leave the catalogue lopsided.
  outer: for (let page = 1; page <= pagesPerSeed; page += 1) {
    for (const seed of seeds) {
      if (budget <= 0) {
        result.capReached = true;
        break outer;
      }

      const found = await search.searchProducts(seed, 40, page);
      result.pagesFetched += 1;

      if (!found.available) {
        // Unavailability is a result, not a fault. A blocked page now does not
        // mean the next seed is blocked, so this keeps going rather than
        // abandoning the run.
        logger.warn('catalogue discovery page unavailable', {
          seed,
          page,
          reason: found.reason,
        });
        continue;
      }

      if (found.candidates.length === 0) {
        // Ran off the end of this seed's results. Deeper pages will be empty
        // too, but other seeds may still have depth.
        continue;
      }

      // One query for the whole page rather than one per candidate. On a
      // second run nearly every candidate is already known, and 24 round trips
      // per page to learn that would dominate the job's cost.
      const externalIds = found.candidates.map((candidate) => candidate.externalId);
      const known = await prisma.marketplaceListing.findMany({
        where: { platform: 'FLIPKART', externalId: { in: externalIds } },
        select: { externalId: true },
      });
      const knownIds = new Set(known.map((listing) => listing.externalId));

      for (const candidate of found.candidates) {
        if (budget <= 0) {
          result.capReached = true;
          break outer;
        }

        if (knownIds.has(candidate.externalId)) {
          result.alreadyKnown += 1;
          continue;
        }

        const created = await enrol(prisma, candidate);
        if (created) {
          result.enrolled += 1;
          budget -= 1;
        } else {
          result.alreadyKnown += 1;
        }
      }

      // Deliberately paced. This job exists to run unattended for hours, and
      // the difference between a polite crawl and one that gets the deployment
      // blocked is entirely in this line.
      if (pageDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
      }
    }
  }

  logger.info('catalogue discovery finished', { ...result });
  return result;
}

/**
 * Create the product and listing rows for one candidate.
 *
 * Mirrors ProductsService.createPendingProduct: a PENDING product with a
 * placeholder title, and a listing that is tracked from the moment it exists.
 * The real title, price and specs arrive when the daily sweep fetches it —
 * this job deliberately does NOT fetch product pages itself.
 *
 * That split is the whole reason discovery is affordable. One search page
 * yields 24 products for one request; fetching each product page to fill it in
 * immediately would be 24 more requests and would turn a 2 500-product crawl
 * into 2 500 extra fetches competing with the sweep that actually records
 * prices.
 *
 * Returns false if the listing already existed — two runs, or a user searching
 * the same URL mid-run, race here and the unique index settles it.
 */
async function enrol(
  prisma: PrismaClient,
  candidate: { externalId: string; url: string; title: string },
): Promise<boolean> {
  const placeholder = candidate.title.trim() || `Flipkart product ${candidate.externalId}`;

  try {
    await prisma.product.create({
      data: {
        status: ProductStatus.PENDING,
        displayTitle: placeholder,
        normalizedTitle: placeholder.toLowerCase(),
        listings: {
          create: {
            platform: 'FLIPKART',
            externalId: candidate.externalId,
            url: candidate.url,
            title: placeholder,
            normalizedTitle: placeholder.toLowerCase(),
            trackingEnabled: true,
            // Deliberately NOT set to now().
            //
            // lastSearchedAt means "a person asked for this". Stamping it here
            // would make every discovered product look freshly requested, and
            // retire-stale-tracking — which retires listings nobody has
            // searched in 12 months — would never retire any of them. Leaving
            // it null is what lets a discovered product that never draws a
            // single visitor eventually stand down and free its budget.
            lastSearchedAt: null,
          },
        },
      },
      select: { id: true },
    });

    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return false;
    }
    throw error;
  }
}
