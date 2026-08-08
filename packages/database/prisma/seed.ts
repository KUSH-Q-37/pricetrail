/**
 * Development seed.
 *
 * Produces enough realistic data to build against before any scraper exists:
 *   - an admin and a regular user
 *   - two products spanning both category families (electronics + appliances)
 *   - Amazon and Flipkart listings for each
 *   - ~400 days of daily price history, so every chart range (7D through 1.5Y)
 *     has something to render in Phase 12
 *   - one confirmed and one review-pending match, so the Phase 9 admin queue
 *     is not empty on first run
 *
 * Deterministic: the random walk uses a fixed-seed LCG, so re-running produces
 * byte-identical history. Idempotent: safe to run repeatedly.
 *
 * Embeddings are deliberately left NULL — they are produced by the Phase 10
 * worker, and seeding fake vectors would make the ANN index look like it works
 * when it has never been exercised.
 */
import {
  PrismaClient,
  Platform,
  DataSource,
  Availability,
  ProductCategory,
  ProductStatus,
  MatchStatus,
  MatchedBy,
  UserRole,
  PlanTier,
} from '../generated/client';

const prisma = new PrismaClient();

const HISTORY_DAYS = 400;
const PIPELINE_VERSION = 'seed-0';

// Fixed UUIDs so re-seeding updates rather than duplicates.
const IDS = {
  adminUser: '00000000-0000-4000-8000-000000000001',
  demoUser: '00000000-0000-4000-8000-000000000002',
  phone: '00000000-0000-4000-8000-000000000010',
  fridge: '00000000-0000-4000-8000-000000000011',
  phoneAmazon: '00000000-0000-4000-8000-000000000020',
  phoneFlipkart: '00000000-0000-4000-8000-000000000021',
  fridgeAmazon: '00000000-0000-4000-8000-000000000022',
  fridgeFlipkart: '00000000-0000-4000-8000-000000000023',
} as const;

/** Deterministic PRNG (numerical recipes LCG) so seeds are reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** UTC midnight `daysAgo` days before today — matches the captured_on contract. */
function utcDay(daysAgo: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

interface PricePointSeed {
  listingId: string;
  capturedOn: Date;
  capturedAt: Date;
  priceMinor: number;
  mrpMinor: number;
  discountPercent: number;
  availability: Availability;
  source: DataSource;
}

/**
 * Generate a plausible price series: a slow downward drift with occasional
 * sale events, clamped to a floor. Roughly 3% of days are skipped to simulate
 * failed fetches — the chart must render those as real gaps, not interpolate.
 */
function generateHistory(
  listingId: string,
  startPriceMinor: number,
  mrpMinor: number,
  seed: number,
): PricePointSeed[] {
  const rand = makeRandom(seed);
  const points: PricePointSeed[] = [];
  const floor = Math.round(startPriceMinor * 0.72);

  let price = startPriceMinor;

  for (let daysAgo = HISTORY_DAYS; daysAgo >= 0; daysAgo--) {
    // Simulated fetch failure — leave a genuine hole in the series.
    if (rand() < 0.03) continue;

    const roll = rand();
    if (roll < 0.04) {
      price = Math.round(price * (0.86 + rand() * 0.06)); // sale event
    } else if (roll < 0.08) {
      price = Math.round(price * (1.03 + rand() * 0.04)); // sale ends
    } else {
      price = Math.round(price * (0.998 + rand() * 0.004)); // drift
    }

    price = Math.max(floor, Math.min(price, mrpMinor));

    const capturedOn = utcDay(daysAgo);
    const capturedAt = new Date(capturedOn);
    capturedAt.setUTCHours(2, Math.floor(rand() * 60), 0, 0);

    points.push({
      listingId,
      capturedOn,
      capturedAt,
      priceMinor: price,
      mrpMinor,
      discountPercent: Math.round(((mrpMinor - price) / mrpMinor) * 100),
      availability: rand() < 0.02 ? Availability.OUT_OF_STOCK : Availability.IN_STOCK,
      source: DataSource.API,
    });
  }

  return points;
}

async function main(): Promise<void> {
  console.log('seeding...');

  // --- users ---------------------------------------------------------------
  await prisma.user.upsert({
    where: { id: IDS.adminUser },
    update: {},
    create: {
      id: IDS.adminUser,
      supabaseUserId: IDS.adminUser,
      email: 'admin@pricetrail.local',
      displayName: 'Seed Admin',
      role: UserRole.ADMIN,
      planTier: PlanTier.BUSINESS,
      trackingQuota: 1000,
    },
  });

  await prisma.user.upsert({
    where: { id: IDS.demoUser },
    update: {},
    create: {
      id: IDS.demoUser,
      supabaseUserId: IDS.demoUser,
      email: 'demo@pricetrail.local',
      displayName: 'Demo User',
      role: UserRole.USER,
      planTier: PlanTier.FREE,
      trackingQuota: 10,
    },
  });

  // --- products ------------------------------------------------------------
  await prisma.product.upsert({
    where: { id: IDS.phone },
    update: {},
    create: {
      id: IDS.phone,
      category: ProductCategory.PHONE,
      brand: 'Apple',
      displayTitle: 'Apple iPhone 15 Pro (256 GB, Natural Titanium)',
      normalizedTitle: 'apple iphone 15 pro 256 gb natural titanium',
      modelNumber: 'A3102',
      status: ProductStatus.READY,
      attributes: { storage_gb: 256, ram_gb: 8, colour: 'natural titanium' },
    },
  });

  await prisma.product.upsert({
    where: { id: IDS.fridge },
    update: {},
    create: {
      id: IDS.fridge,
      category: ProductCategory.REFRIGERATOR,
      brand: 'LG',
      displayTitle: 'LG 260 L 3 Star Frost-Free Double Door Refrigerator',
      normalizedTitle: 'lg 260 l 3 star frost free double door refrigerator',
      modelNumber: 'GL-S292RPZX',
      status: ProductStatus.READY,
      attributes: { capacity_l: 260, star_rating: 3, type: 'double door' },
    },
  });

  // --- listings ------------------------------------------------------------
  const listings = [
    {
      id: IDS.phoneAmazon,
      productId: IDS.phone,
      platform: Platform.AMAZON,
      externalId: 'B0CHX1W1XY',
      url: 'https://www.amazon.in/dp/B0CHX1W1XY',
      title: 'Apple iPhone 15 Pro (256 GB) - Natural Titanium',
      normalizedTitle: 'apple iphone 15 pro 256 gb natural titanium',
      brand: 'Apple',
      modelNumber: 'A3102',
      ean: '0195949022029',
      sellerName: 'Appario Retail Private Ltd',
      rating: 4.6,
      reviewCount: 3421,
      mrpMinor: 14990000,
      startPriceMinor: 13999900,
      platformData: { salesRank: 42, browseNode: 'Electronics > Mobiles' },
      seed: 1001,
    },
    {
      id: IDS.phoneFlipkart,
      productId: IDS.phone,
      platform: Platform.FLIPKART,
      externalId: 'MOBGTAGPTB3VS24W',
      url: 'https://www.flipkart.com/apple-iphone-15-pro/p/itm6ac6485515ae4',
      title: 'APPLE iPhone 15 Pro (Natural Titanium, 256 GB)',
      normalizedTitle: 'apple iphone 15 pro natural titanium 256 gb',
      brand: 'Apple',
      modelNumber: 'A3102',
      ean: '0195949022029',
      sellerName: 'SuperComNet',
      rating: 4.7,
      reviewCount: 5120,
      mrpMinor: 14990000,
      startPriceMinor: 13899000,
      platformData: { fAssured: true, plusEligible: true },
      seed: 1002,
    },
    {
      id: IDS.fridgeAmazon,
      productId: IDS.fridge,
      platform: Platform.AMAZON,
      externalId: 'B0BQ7XYZ12',
      url: 'https://www.amazon.in/dp/B0BQ7XYZ12',
      title: 'LG 260 L 3 Star Frost Free Double Door Refrigerator (Shiny Steel)',
      normalizedTitle: 'lg 260 l 3 star frost free double door refrigerator shiny steel',
      brand: 'LG',
      modelNumber: 'GL-S292RPZX',
      ean: '8806098374519',
      sellerName: 'Cocoblu Retail',
      rating: 4.3,
      reviewCount: 1187,
      mrpMinor: 3799000,
      startPriceMinor: 2899000,
      platformData: { salesRank: 118, browseNode: 'Appliances > Refrigerators' },
      seed: 1003,
    },
    {
      id: IDS.fridgeFlipkart,
      productId: IDS.fridge,
      platform: Platform.FLIPKART,
      externalId: 'RFRGTAGPQXYZ001',
      url: 'https://www.flipkart.com/lg-260-l-frost-free/p/itm9f8a7b6c5d4e3',
      title: 'LG 260 L Frost Free Double Door 3 Star Refrigerator (Shiny Steel)',
      normalizedTitle: 'lg 260 l frost free double door 3 star refrigerator shiny steel',
      brand: 'LG',
      modelNumber: 'GL-S292RPZX',
      ean: '8806098374519',
      sellerName: 'OmniTechRetail',
      rating: 4.2,
      reviewCount: 906,
      mrpMinor: 3799000,
      startPriceMinor: 2849000,
      platformData: { fAssured: true },
      seed: 1004,
    },
  ];

  for (const l of listings) {
    await prisma.marketplaceListing.upsert({
      where: { platform_externalId: { platform: l.platform, externalId: l.externalId } },
      update: {},
      create: {
        id: l.id,
        productId: l.productId,
        platform: l.platform,
        externalId: l.externalId,
        url: l.url,
        title: l.title,
        normalizedTitle: l.normalizedTitle,
        brand: l.brand,
        modelNumber: l.modelNumber,
        ean: l.ean,
        sellerName: l.sellerName,
        rating: l.rating,
        reviewCount: l.reviewCount,
        currency: 'INR',
        currentPriceMinor: l.startPriceMinor,
        mrpMinor: l.mrpMinor,
        availability: Availability.IN_STOCK,
        source: DataSource.API,
        trackingEnabled: true,
        lastScrapedAt: new Date(),
        lastSuccessAt: new Date(),
        platformData: l.platformData,
        rawAttributes: {},
      },
    });
  }

  // --- price history -------------------------------------------------------
  // createMany + skipDuplicates makes re-seeding a no-op rather than a PK error.
  let totalPoints = 0;
  for (const l of listings) {
    const points = generateHistory(l.id, l.startPriceMinor, l.mrpMinor, l.seed);
    const result = await prisma.pricePoint.createMany({
      data: points,
      skipDuplicates: true,
    });
    totalPoints += result.count;

    const latest = points[points.length - 1];
    if (latest) {
      await prisma.marketplaceListing.update({
        where: { id: l.id },
        data: {
          currentPriceMinor: latest.priceMinor,
          discountPercent: latest.discountPercent,
          availability: latest.availability,
        },
      });
    }
  }

  // --- matches -------------------------------------------------------------
  // Listing IDs are stored in canonical (A < B) order so the unique constraint
  // dedupes regardless of which direction the pipeline ran.
  const pairs = [
    {
      a: IDS.phoneAmazon,
      b: IDS.phoneFlipkart,
      confidence: 0.9642,
      identifier: 1.0,
      attribute: 0.95,
      semantic: 0.9,
      status: MatchStatus.AUTO_CONFIRMED,
    },
    {
      a: IDS.fridgeAmazon,
      b: IDS.fridgeFlipkart,
      confidence: 0.7310,
      identifier: 0.5,
      attribute: 0.8,
      semantic: 0.92,
      status: MatchStatus.NEEDS_REVIEW,
    },
  ];

  for (const p of pairs) {
    const [listingAId, listingBId] = p.a < p.b ? [p.a, p.b] : [p.b, p.a];
    await prisma.productMatch.upsert({
      where: { listingAId_listingBId: { listingAId, listingBId } },
      update: {},
      create: {
        listingAId,
        listingBId,
        confidence: p.confidence,
        identifierScore: p.identifier,
        attributeScore: p.attribute,
        semanticScore: p.semantic,
        status: p.status,
        matchedBy: MatchedBy.PIPELINE,
        pipelineVersion: PIPELINE_VERSION,
      },
    });
  }

  // --- tracking ------------------------------------------------------------
  for (const productId of [IDS.phone, IDS.fridge]) {
    await prisma.trackedProduct.upsert({
      where: { userId_productId: { userId: IDS.demoUser, productId } },
      update: {},
      create: { userId: IDS.demoUser, productId },
    });
  }

  console.log(
    `seeded: 2 users, 2 products, ${listings.length} listings, ` +
      `${totalPoints} price points, ${pairs.length} matches`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
