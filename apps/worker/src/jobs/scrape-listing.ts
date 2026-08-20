import {
  Availability,
  DataSource,
  FetchStrategy as DbFetchStrategy,
  Platform,
  ProductStatus,
  ScrapeJobStatus,
  businessDate,
  type PrismaClient,
} from '@pricetrail/database';
import {
  FetchError,
  classifyForTracking,
  normalizeAttributes,
  normalizeTitle,
  type FetchOutcome,
  type MarketplaceAdapter,
} from '@pricetrail/marketplace';

/** Consecutive failures after which a listing stops being fetched. */
export const FAILURE_PAUSE_THRESHOLD = 5;

export interface ScrapeResult {
  status: 'SUCCEEDED' | 'FAILED';
  strategy?: string;
  priceMinor?: number;
  pricePointWritten: boolean;
  paused: boolean;
  errorReason?: string;
}

export interface ScrapeDeps {
  prisma: PrismaClient;
  /** Resolved per platform so tests can inject a fixture-backed adapter. */
  getAdapter: (platform: Platform) => MarketplaceAdapter;
  now?: () => Date;
  /**
   * Optional so the existing tests, which construct deps directly, keep
   * working. The only thing it currently reports is a listing dropped for
   * being outside the tracked categories — which is invisible otherwise, and
   * is exactly what you need to see when a product you expected to track
   * quietly stops updating.
   */
  logger?: { info: (message: string, meta?: Record<string, unknown>) => void };
}

/**
 * Fetch one listing, validate, and persist.
 *
 * The whole point of this job is that it either records a TRUSTWORTHY
 * observation or records nothing at all. There is no partial write: the
 * boundary schema in packages/marketplace has already rejected anything
 * suspect before we get here, and a thrown FetchError means the day gets a gap
 * rather than a guess.
 */
export async function scrapeListing(
  deps: ScrapeDeps,
  input: {
    listingId: string;
    platform: Platform;
    externalId: string;
    url: string;
    forceStrategy?: 'API' | 'HTTP_CHEERIO' | 'PLAYWRIGHT';
    attempt?: number;
    queueJobId?: string;
  },
): Promise<ScrapeResult> {
  const { prisma, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const startedAt = now();

  // Audit row first, so a process killed mid-fetch still leaves evidence that
  // the attempt happened. A row written only on completion means crashes are
  // invisible — exactly the failure mode you most need to see.
  const auditRow = await prisma.scrapeJob.create({
    data: {
      listingId: input.listingId,
      platform: input.platform,
      queueJobId: input.queueJobId ?? null,
      status: ScrapeJobStatus.RUNNING,
      strategy: DbFetchStrategy.HTTP_CHEERIO,
      attempt: input.attempt ?? 1,
      startedAt,
    },
    select: { id: true },
  });

  let outcome: FetchOutcome;

  try {
    outcome = await deps
      .getAdapter(input.platform)
      .fetchProduct({
        externalId: input.externalId,
        url: input.url,
        strategy: input.forceStrategy,
      });
  } catch (error) {
    const fetchError = error instanceof FetchError ? error : undefined;
    const finishedAt = now();

    await prisma.scrapeJob.update({
      where: { id: auditRow.id },
      data: {
        status: ScrapeJobStatus.FAILED,
        httpStatus: fetchError?.httpStatus ?? null,
        errorCode: fetchError?.reason ?? 'UNKNOWN',
        errorMessage: (error as Error).message?.slice(0, 2000) ?? null,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        finishedAt,
      },
    });

    const listing = await prisma.marketplaceListing.update({
      where: { id: input.listingId },
      data: {
        lastScrapedAt: finishedAt,
        consecutiveFailures: { increment: 1 },
      },
      select: { consecutiveFailures: true },
    });

    // Stop paying to fetch a URL that has failed five times running. Without
    // this a delisted product is retried every day forever, and its failures
    // drown the ones that matter in the scraper-health view.
    let paused = false;
    if (listing.consecutiveFailures >= FAILURE_PAUSE_THRESHOLD) {
      await prisma.marketplaceListing.update({
        where: { id: input.listingId },
        data: { trackingEnabled: false },
      });
      paused = true;
    }

    // Rethrown so BullMQ applies its backoff and retry policy — but only for
    // reasons where a retry could plausibly succeed. PARSE_FAILED and
    // VALIDATION_FAILED mean our selectors could not read a page that arrived
    // fine, so three more identical attempts just burn crawl budget.
    if (fetchError && !fetchError.isRetryable) {
      return {
        status: 'FAILED',
        paused,
        pricePointWritten: false,
        errorReason: fetchError.reason,
      };
    }
    throw error;
  }

  const finishedAt = now();
  const product = outcome.product;

  // captured_on is the partition key and the daily identity — the business
  // date in Asia/Kolkata, not the UTC date.
  //
  // This used to be getUTCDate(). The scheduler fires on a cron with tz
  // Asia/Kolkata, so 02:00 IST is 20:30 UTC the previous day: the day boundary
  // sat at 05:30 IST, and an observation taken at 00:30 IST was filed under
  // yesterday. Consistent with itself, and consistently wrong.
  const capturedOn = businessDate(finishedAt);

  const attributes = normalizeAttributes(product.rawAttributes);

  // Scope check, at the first moment the product's category is actually known.
  //
  // It cannot happen at search time: ingest has a URL and nothing else, and a
  // URL slug is not a category — "nike-revolution-6" is legible to a person
  // and not to a parser, and Amazon URLs frequently carry no words at all. So
  // a product is enrolled optimistically, and the first successful fetch is
  // what decides whether it stays.
  //
  // Untracked, not deleted. The price observed on this run is still recorded:
  // the fetch already happened and throwing the number away would leave a gap
  // in a chart for no gain. What stops is FUTURE collection.
  const scope = classifyForTracking(product.platformCategory);
  if (scope.action === 'untrack') {
    await prisma.marketplaceListing.update({
      where: { id: input.listingId },
      data: { trackingEnabled: false },
    });

    // Logged with the slug, because 'unknown-category' means this list needs
    // extending, whereas 'not-in-scope' means it worked. The two are
    // indistinguishable without the slug, and only one is a reason to act.
    logger?.info('listing untracked: outside tracked categories', {
      listingId: input.listingId,
      category: scope.slug ?? '(none stated)',
      reason: scope.reason,
      title: product.title.slice(0, 80),
    });
  }

  const written = await prisma.$transaction(async (tx) => {
    await tx.marketplaceListing.update({
      where: { id: input.listingId },
      data: {
        title: product.title,
        normalizedTitle: normalizeTitle(product.title),
        brand: product.brand ?? null,
        modelNumber: product.modelNumber ?? null,
        mpn: product.mpn ?? null,
        ean: product.ean ?? null,
        upc: product.upc ?? null,
        sellerName: product.sellerName ?? null,
        rating: product.rating ?? null,
        reviewCount: product.reviewCount ?? null,
        imageUrl: product.imageUrl ?? null,
        currency: product.currency,
        currentPriceMinor: product.priceMinor ?? null,
        mrpMinor: product.mrpMinor ?? null,
        discountPercent: product.discountPercent ?? null,
        availability: product.availability as Availability,
        source: product.source as DataSource,
        rawAttributes: product.rawAttributes,
        // Category folded into platformData rather than given its own column.
        // It is exactly what platformData is for — platform-specific extras —
        // and it means the value behind every tracking decision is queryable
        // without a migration. Without it, "why did this stop updating?" can
        // only be answered from logs that have since rotated.
        platformData: {
          ...product.platformData,
          ...(product.platformCategory ? { category: product.platformCategory } : {}),
        } as never,
        lastScrapedAt: finishedAt,
        lastSuccessAt: finishedAt,
        // Reset on success: the threshold counts CONSECUTIVE failures, so a
        // single good fetch must clear the history.
        consecutiveFailures: 0,
      },
    });

    // Promote the canonical product out of PENDING and fill in what the
    // fetcher learned. This is what flips the UI from "Fetching details".
    await tx.product.update({
      where: { id: (await tx.marketplaceListing.findUniqueOrThrow({
        where: { id: input.listingId },
        select: { productId: true },
      })).productId },
      data: {
        status: ProductStatus.READY,
        displayTitle: product.title,
        normalizedTitle: normalizeTitle(product.title),
        brand: product.brand ?? null,
        modelNumber: product.modelNumber ?? null,
        imageUrl: product.imageUrl ?? null,
        attributes: attributes as never,
      },
    });

    if (product.priceMinor === undefined) return false;

    // At most one row per listing per day, holding the LATEST observation of
    // that day.
    //
    // This was createMany + skipDuplicates, which kept the FIRST observation
    // and silently discarded any later one. The listing's denormalised
    // current_price_minor is written unconditionally a few lines above, so a
    // second scrape in the same day moved the card and left the day's record
    // behind — and the product detail page then showed two different "current"
    // prices for one listing, one on the card and one at the end of the chart.
    //
    // For a product whose entire claim is "we record what things actually
    // cost", disagreeing with itself on one screen is the worst kind of bug.
    //
    // An upsert is still safe against the redelivery the old comment worried
    // about: BullMQ will redeliver a job whose worker died after the write but
    // before the ack, and re-applying the same values is a no-op rather than a
    // primary-key violation.
    const payload = {
      capturedAt: finishedAt,
      currency: product.currency,
      priceMinor: product.priceMinor,
      mrpMinor: product.mrpMinor ?? null,
      discountPercent: product.discountPercent ?? null,
      availability: product.availability as Availability,
      source: product.source as DataSource,
    };

    const before = await tx.pricePoint.findUnique({
      where: { listingId_capturedOn: { listingId: input.listingId, capturedOn } },
      select: { priceMinor: true },
    });

    await tx.pricePoint.upsert({
      where: { listingId_capturedOn: { listingId: input.listingId, capturedOn } },
      create: { listingId: input.listingId, capturedOn, ...payload },
      update: payload,
    });

    // "Did today's record change?" — true for a first observation, and for a
    // later one that moved the price. A re-run returning the same number is
    // not news and should not read as one.
    return before === null || before.priceMinor !== product.priceMinor;
  });

  await prisma.scrapeJob.update({
    where: { id: auditRow.id },
    data: {
      status: ScrapeJobStatus.SUCCEEDED,
      strategy: outcome.strategy as DbFetchStrategy,
      httpStatus: outcome.httpStatus ?? null,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      finishedAt,
    },
  });

  return {
    status: 'SUCCEEDED',
    strategy: outcome.strategy,
    priceMinor: product.priceMinor,
    pricePointWritten: written,
    paused: false,
  };
}
