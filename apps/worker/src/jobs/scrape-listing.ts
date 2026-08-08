import {
  Availability,
  DataSource,
  FetchStrategy as DbFetchStrategy,
  Platform,
  ProductStatus,
  ScrapeJobStatus,
  type PrismaClient,
} from '@pricetrail/database';
import {
  FetchError,
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
  const { prisma } = deps;
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

  // captured_on is the partition key and the daily identity. UTC date, matching
  // the column contract from Phase 2.
  const capturedOn = new Date(
    Date.UTC(
      finishedAt.getUTCFullYear(),
      finishedAt.getUTCMonth(),
      finishedAt.getUTCDate(),
    ),
  );

  const attributes = normalizeAttributes(product.rawAttributes);

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
        platformData: product.platformData as never,
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

    // Append-only, at most one row per listing per day. `skipDuplicates`
    // makes a same-day re-run a no-op instead of a primary-key violation —
    // which matters because BullMQ WILL redeliver a job whose worker died
    // after the write but before the ack.
    const result = await tx.pricePoint.createMany({
      data: [
        {
          listingId: input.listingId,
          capturedOn,
          capturedAt: finishedAt,
          currency: product.currency,
          priceMinor: product.priceMinor,
          mrpMinor: product.mrpMinor ?? null,
          discountPercent: product.discountPercent ?? null,
          availability: product.availability as Availability,
          source: product.source as DataSource,
        },
      ],
      skipDuplicates: true,
    });

    return result.count > 0;
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
