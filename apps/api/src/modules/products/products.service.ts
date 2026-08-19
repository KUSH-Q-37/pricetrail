import { Injectable } from '@nestjs/common';
import {
  MarketplaceUrlError,
  parseMarketplaceUrl,
  type ParsedMarketplaceUrl,
} from '@pricetrail/marketplace';
import { Platform, ProductStatus, Prisma, businessDate } from '@pricetrail/database';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import {
  AppError,
  ErrorCode,
  NotFoundError,
} from '../../common/errors/app-error';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';
import type { ListProductsQuery } from './product.schemas';

/** Shape returned to clients. Deliberately narrower than the DB row. */
export interface ProductSummary {
  id: string;
  status: ProductStatus;
  category: string;
  brand: string | null;
  title: string;
  imageUrl: string | null;
  createdAt: Date;
  listings: Array<{
    id: string;
    platform: Platform;
    externalId: string;
    url: string;
    title: string;
    currency: string;
    currentPriceMinor: number | null;
    mrpMinor: number | null;
    discountPercent: number | null;
    availability: string;
    rating: string | null;
    reviewCount: number | null;
    sellerName: string | null;
    trackingEnabled: boolean;
    lastSuccessAt: Date | null;
    consecutiveFailures: number;
  }>;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    @InjectPinoLogger(ProductsService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Search a marketplace URL. Finding it is what starts tracking it.
   *
   * Idempotent by construction. `(platform, external_id)` is unique, so
   * pasting the same URL twice — or two users adding the same product —
   * resolves to the existing listing rather than creating a duplicate. That
   * matters well beyond tidiness: a duplicate listing would be scraped
   * separately every day, doubling the fetch budget for one product and
   * splitting its price history across two rows.
   */
  async ingestByUrl(rawUrl: string): Promise<ProductSummary> {
    const parsed = this.parseOrThrow(rawUrl);

    const existing = await this.prisma.marketplaceListing.findUnique({
      where: {
        platform_externalId: {
          platform: parsed.platform as Platform,
          externalId: parsed.externalId,
        },
      },
      select: { productId: true },
    });

    const productId = existing
      ? existing.productId
      : await this.createPendingProduct(parsed);

    // Searching a URL IS what puts it into global tracking.
    //
    // Global collection is a property of the listing, not of any user's
    // interest in it. Previously only newly-created listings got
    // trackingEnabled = true, so a listing that had been untracked stayed
    // untracked no matter how many people searched it, and the daily sweep
    // skipped it forever.
    //
    // Unconditional, because there is no longer any per-user state that could
    // qualify it. Searching a URL is the whole enrolment.
    const listing = await this.prisma.marketplaceListing.update({
      where: {
        platform_externalId: {
          platform: parsed.platform as Platform,
          externalId: parsed.externalId,
        },
      },
      // lastSearchedAt is what lets retirement distinguish a product people
      // still look at from one searched once a year ago. Without it the
      // tracked set could only ever grow.
      //
      // consecutiveFailures resets too, and that pairing matters. A listing
      // that failed five times running is auto-paused, and re-enabling it
      // without clearing the counter revives it one failure away from pausing
      // again — so it would stand down after a single bad fetch and look, to
      // the user who just searched it, as though tracking simply did not work.
      //
      // Someone deliberately searching a URL is a strong signal it is worth
      // another go, so it gets a full five attempts rather than the remains of
      // an old streak. If the product really is delisted it pauses again, and
      // the pause still means what it says.
      data: { trackingEnabled: true, lastSearchedAt: new Date(), consecutiveFailures: 0 },
      select: { id: true, url: true },
    });

    // Collect today's observation now rather than waiting for the 02:00 sweep.
    //
    // The guard is "has today been observed", not "has this ever succeeded".
    // The old condition (!lastSuccessAt) meant a product fetched once, months
    // ago, produced nothing on a re-search — the user saw a stale price and
    // the day's data point was simply missed.
    //
    // The enqueue is idempotent per listing per business day and shares its id
    // with the sweep, so searching a product the sweep has already queued
    // promotes that job rather than adding a second fetch.
    const observedToday = await this.prisma.pricePoint.findUnique({
      where: {
        listingId_capturedOn: { listingId: listing.id, capturedOn: businessDate() },
      },
      select: { listingId: true },
    });

    if (!observedToday) {
      await this.queue.enqueueScrape({
        listingId: listing.id,
        platform: parsed.platform as Platform,
        externalId: parsed.externalId,
        url: listing.url,
      });
    }

    const summary = await this.findById(productId);

    this.logger.info(
      {
        productId,
        platform: parsed.platform,
        externalId: parsed.externalId,
        reused: Boolean(existing),
      },
      'Ingested marketplace URL',
    );

    return summary;
  }

  /**
   * Create the canonical product plus its first listing, in PENDING state.
   *
   * No title, price or specifications are known yet — those arrive when the
   * Phase 7/8 fetchers run. Writing a placeholder title rather than leaving it
   * null keeps the column non-nullable and gives the UI something honest to
   * render while `status` is PENDING.
   */
  private async createPendingProduct(parsed: ParsedMarketplaceUrl): Promise<string> {
    const placeholder = `${parsed.platform === 'AMAZON' ? 'Amazon' : 'Flipkart'} product ${parsed.externalId}`;

    try {
      const product = await this.prisma.product.create({
        data: {
          status: ProductStatus.PENDING,
          displayTitle: placeholder,
          normalizedTitle: placeholder.toLowerCase(),
          listings: {
            create: {
              platform: parsed.platform as Platform,
              externalId: parsed.externalId,
              url: parsed.canonicalUrl,
              title: placeholder,
              normalizedTitle: placeholder.toLowerCase(),
              // Tracking is enabled immediately so the daily sweep picks it up
              // as soon as the fetchers exist.
              trackingEnabled: true,
            },
          },
        },
        select: { id: true },
      });

      return product.id;
    } catch (error) {
      // Two concurrent ingests of the same new URL race here. The unique index
      // is what actually prevents the duplicate; this turns the resulting
      // constraint violation into the correct outcome rather than a 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.marketplaceListing.findUnique({
          where: {
            platform_externalId: {
              platform: parsed.platform as Platform,
              externalId: parsed.externalId,
            },
          },
          select: { productId: true },
        });
        if (winner) return winner.productId;
      }
      throw error;
    }
  }

  async list(
    query: ListProductsQuery,
  ): Promise<{ items: ProductSummary[]; total: number; page: number; pageSize: number }> {
    const where: Prisma.ProductWhereInput = {
      ...(query.search
        ? { normalizedTitle: { contains: query.search.toLowerCase() } }
        : {}),
    };

    // Count and page in one round trip.
    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          listings: { orderBy: { platform: 'asc' } },
        },
      }),
    ]);

    return {
      items: products.map((product) => this.toSummary(product)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async findById(productId: string): Promise<ProductSummary> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId },
      include: {
        listings: { orderBy: { platform: 'asc' } },
      },
    });

    if (!product) throw new NotFoundError('Product', productId);

    return this.toSummary(product);
  }

  private parseOrThrow(rawUrl: string): ParsedMarketplaceUrl {
    try {
      return parseMarketplaceUrl(rawUrl);
    } catch (error) {
      if (error instanceof MarketplaceUrlError) {
        // The parser's reason codes carry enough detail to tell the user what
        // to do differently, so the message is passed through verbatim.
        throw new AppError(
          error.reason === 'UNSUPPORTED_HOST'
            ? ErrorCode.UNSUPPORTED_MARKETPLACE
            : ErrorCode.VALIDATION_FAILED,
          error.message,
          400,
          [{ path: 'url', message: error.message, code: error.reason }],
        );
      }
      throw error;
    }
  }

  private toSummary(
    product: Prisma.ProductGetPayload<{
      include: { listings: true };
    }>,
  ): ProductSummary {

    return {
      id: product.id,
      status: product.status,
      category: product.category,
      brand: product.brand,
      title: product.displayTitle,
      imageUrl: product.imageUrl,
      createdAt: product.createdAt,
      listings: product.listings.map((listing) => ({
        id: listing.id,
        platform: listing.platform,
        externalId: listing.externalId,
        url: listing.url,
        title: listing.title,
        currency: listing.currency,
        currentPriceMinor: listing.currentPriceMinor,
        mrpMinor: listing.mrpMinor,
        discountPercent: listing.discountPercent,
        availability: listing.availability,
        // Prisma Decimal does not survive JSON.stringify meaningfully; send a
        // string and let the client format it.
        rating: listing.rating ? listing.rating.toString() : null,
        reviewCount: listing.reviewCount,
        sellerName: listing.sellerName,
        trackingEnabled: listing.trackingEnabled,
        lastSuccessAt: listing.lastSuccessAt,
        consecutiveFailures: listing.consecutiveFailures,
      })),
    };
  }
}
