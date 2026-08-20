import type { Platform, PrismaClient } from '@pricetrail/database';
import { classifyForTracking, type MarketplaceAdapter } from '@pricetrail/marketplace';

/**
 * Apply tracking scope to listings that are already in the catalogue.
 *
 * The scope gate in scrape-listing only fires when a listing is fetched, so it
 * governs everything arriving from now on and nothing already here. On the day
 * it shipped the catalogue held a kurti set, a tub of whey protein and a phone
 * screen guard, all tracked, and all of which would have stayed tracked until
 * the next daily sweep happened to touch them.
 *
 * Waiting for the sweep is nearly right and not quite good enough: it means up
 * to a day where the catalogue visibly contradicts what the project says it
 * collects. It also means that changing the allowlist has no effect until the
 * following night, which makes the list painful to correct.
 *
 * TWO PATHS, AND THE CHEAP ONE IS THE COMMON ONE
 * ----------------------------------------------
 * Once a listing has been fetched, its category is stored in platformData, so
 * reclassifying it is a database read and nothing else. Only listings never
 * fetched since the gate shipped need a network call, and that population
 * shrinks to zero after one pass.
 *
 * So the free path runs over everything, every time — which is what makes an
 * allowlist edit take effect within the hour rather than overnight — and the
 * expensive path is bounded per run, so the first pass over a full catalogue
 * spreads across several runs instead of firing thousands of fetches at once.
 */

export interface ReclassifyOptions {
  prisma: PrismaClient;
  getAdapter: (platform: Platform) => MarketplaceAdapter;
  /** Listings to FETCH per run. The stored-category path is unbounded. */
  fetchBudget: number;
  /** Politeness delay between fetches. */
  fetchDelayMs: number;
  logger: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
  };
}

export interface ReclassifyResult {
  /** Tracked listings examined. */
  examined: number;
  /** Untracked from a category already stored — free. */
  untrackedFromStored: number;
  /** Untracked after a fetch. */
  untrackedFromFetch: number;
  /** Fetched to learn a category. */
  fetched: number;
  /** Still unclassified because the fetch budget ran out. */
  deferred: number;
}

export async function reclassifyCatalogue(
  options: ReclassifyOptions,
): Promise<ReclassifyResult> {
  const { prisma, getAdapter, fetchBudget, fetchDelayMs, logger } = options;

  const tracked = await prisma.marketplaceListing.findMany({
    where: { trackingEnabled: true },
    select: {
      id: true,
      platform: true,
      externalId: true,
      url: true,
      title: true,
      platformData: true,
    },
  });

  const result: ReclassifyResult = {
    examined: tracked.length,
    untrackedFromStored: 0,
    untrackedFromFetch: 0,
    fetched: 0,
    deferred: 0,
  };

  const needsFetch: typeof tracked = [];

  // --- free pass: decide from what is already stored -----------------------
  for (const listing of tracked) {
    const stored = readStoredCategory(listing.platformData);

    if (stored === undefined) {
      needsFetch.push(listing);
      continue;
    }

    const decision = classifyForTracking(stored, listing.platform);
    if (decision.action === 'untrack') {
      await prisma.marketplaceListing.update({
        where: { id: listing.id },
        data: { trackingEnabled: false },
      });
      result.untrackedFromStored += 1;

      logger.info('untracked on reclassify (stored category)', {
        listingId: listing.id,
        category: decision.slug,
        reason: decision.reason,
        title: listing.title.slice(0, 70),
      });
    }
  }

  // --- paid pass: fetch what has never been classified ---------------------
  for (const listing of needsFetch) {
    if (result.fetched >= fetchBudget) {
      result.deferred += 1;
      continue;
    }

    let category: string | undefined;
    try {
      // The adapter is already platform-specific, so the request carries no
      // platform of its own.
      const outcome = await getAdapter(listing.platform).fetchProduct({
        externalId: listing.externalId,
        url: listing.url,
      });
      category = outcome.product.platformCategory;
      result.fetched += 1;

      // Persist what the fetch cost us to learn.
      //
      // Without this the job never converges: it would re-fetch every
      // unclassified listing every hour, forever, having already had the
      // answer each time. Storing it moves the listing onto the free path from
      // the next run, which is the entire premise of splitting the two.
      //
      // Merged rather than replaced, because platformData holds other
      // platform-specific extras that this job has no business discarding.
      if (category) {
        const existing =
          listing.platformData !== null && typeof listing.platformData === 'object'
            ? (listing.platformData as Record<string, unknown>)
            : {};

        await prisma.marketplaceListing.update({
          where: { id: listing.id },
          data: { platformData: { ...existing, category } as never },
        });
      }
    } catch {
      // A listing that cannot be fetched is left exactly as it is. The daily
      // sweep already handles failures, including auto-pausing after five in a
      // row; duplicating that here would double-count failures and pause
      // listings twice as fast as intended.
      continue;
    }

    const decision = classifyForTracking(category, listing.platform);
    if (decision.action === 'untrack') {
      await prisma.marketplaceListing.update({
        where: { id: listing.id },
        data: { trackingEnabled: false },
      });
      result.untrackedFromFetch += 1;

      logger.info('untracked on reclassify (fetched category)', {
        listingId: listing.id,
        category: decision.slug,
        reason: decision.reason,
        title: listing.title.slice(0, 70),
      });
    }

    if (fetchDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, fetchDelayMs));
    }
  }

  if (
    result.untrackedFromStored > 0 ||
    result.untrackedFromFetch > 0 ||
    result.deferred > 0
  ) {
    logger.info('catalogue reclassified', { ...result });
  }

  return result;
}

/**
 * The category the last fetch recorded, if any.
 *
 * platformData is an untyped JSON column, so everything about its shape has to
 * be checked rather than assumed — a listing written before the category was
 * stored has the key missing entirely, and one written by an older build could
 * hold anything at all.
 */
function readStoredCategory(platformData: unknown): string | undefined {
  if (platformData === null || typeof platformData !== 'object') return undefined;

  const category = (platformData as Record<string, unknown>)['category'];
  return typeof category === 'string' && category.trim().length > 0
    ? category
    : undefined;
}
