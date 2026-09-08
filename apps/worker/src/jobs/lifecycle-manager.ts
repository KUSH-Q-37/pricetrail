import { PrismaClient, ProductCategory, ProductStatus } from '@pricetrail/database';

export const MAX_ACTIVE_PRODUCTS = 15000;

// High priority categories for VM One relevance
const HIGH_PRIORITY_CATEGORIES = new Set<ProductCategory>([
  ProductCategory.TELEVISION,
  ProductCategory.AIR_CONDITIONER,
  ProductCategory.REFRIGERATOR,
  ProductCategory.WASHING_MACHINE,
  ProductCategory.AUDIO,
]);

export function calculatePriorityScore(
  category: ProductCategory,
  modelYear: number | null,
  youtubeFeatured: boolean,
): number {
  let score = 0;

  // TV, AC, Fridge, Washing Machine, Audio => core VM One focus
  if (HIGH_PRIORITY_CATEGORIES.has(category)) {
    score += 50;
  }

  // Current/recent year models
  if (modelYear) {
    const currentYear = new Date().getUTCFullYear();
    if (modelYear === currentYear) score += 30;
    else if (modelYear === currentYear - 1) score += 10;
  }

  if (youtubeFeatured) {
    score += 100;
  }

  return score;
}

import { MarketplaceListing, Product } from '@pricetrail/database';

export function isEligibleForTracking(
  product: Product & { listings: MarketplaceListing[] },
  systemDate = new Date(),
): boolean {
  // Safety Net 4: Manual Override (VM One Featured or recently searched)
  if (product.youtubeFeatured) return true;
  
  for (const listing of product.listings) {
    if (listing.lastSearchedAt) {
      const thirtyDaysAgo = new Date(systemDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      if (listing.lastSearchedAt >= thirtyDaysAgo) return true;
    }
  }

  // The dynamic 15-month rolling window.
  // Today minus exactly 15 months (~457 days)
  const CUTOFF_DATE = new Date(systemDate.getTime() - (457 * 24 * 60 * 60 * 1000));
  const CUTOFF_YEAR = CUTOFF_DATE.getUTCFullYear();

  // Safety Net 1: Hard Model Year check (Inherits from Amazon automatically)
  if (product.modelYear) {
    return product.modelYear >= CUTOFF_YEAR;
  }

  // Fallbacks for when `modelYear` is completely missing
  let maxReviewCount = 0;
  for (const listing of product.listings) {
    if (listing.reviewCount) {
      maxReviewCount = Math.max(maxReviewCount, listing.reviewCount);
    }
    
    // Safety Net 2: First Review Date Proxy (If available in platformData)
    const platformData = listing.platformData as Record<string, any> | null;
    if (platformData?.firstReviewDate) {
      const firstReview = new Date(platformData.firstReviewDate as string);
      if (firstReview >= CUTOFF_DATE) return true;
      // If we confidently know the first review was BEFORE 2025, it's definitely old.
      if (firstReview < CUTOFF_DATE) return false;
    }
  }

  // Safety Net 3: New Arrival Proxy (Low reviews + Recently discovered)
  if (maxReviewCount < 100 && product.createdAt >= CUTOFF_DATE) {
    return true;
  }

  // If no safety net catches it and it has no model year, it is deemed ineligible.
  return false;
}

export async function archiveProduct(prisma: PrismaClient, productId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.marketplaceListing.updateMany({
      where: { productId },
      data: { trackingEnabled: false },
    });
    
    await tx.product.update({
      where: { id: productId },
      data: { status: ProductStatus.ARCHIVED },
    });
  });
}

export async function activateProduct(prisma: PrismaClient, productId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.marketplaceListing.updateMany({
      where: { productId },
      data: { trackingEnabled: true },
    });
    
    await tx.product.update({
      where: { id: productId },
      data: { status: ProductStatus.READY },
    });
  });
}

export async function evaluateProductLifecycle(
  prisma: PrismaClient,
  productId: string,
): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { listings: true },
  });
  
  if (!product) return;

  // Calculate new priority score
  const priorityScore = calculatePriorityScore(
    product.category as ProductCategory,
    product.modelYear,
    product.youtubeFeatured,
  );

  // If priority score changed, update it.
  if (priorityScore !== product.priorityScore) {
    await prisma.product.update({
      where: { id: productId },
      data: { priorityScore },
    });
  }

  const eligible = isEligibleForTracking(product);

  if (!eligible) {
    // If it's currently tracked, we archive it
    if (product.status !== ProductStatus.ARCHIVED && product.listings.some(l => l.trackingEnabled)) {
      await archiveProduct(prisma, productId);
    }
    return;
  }

  // It is eligible. Are we full?
  const activeCountRows = await prisma.marketplaceListing.groupBy({
    by: ['productId'],
    where: { trackingEnabled: true },
  });
  const activeCount = activeCountRows.length;

  const isAlreadyActive = product.listings.some((l) => l.trackingEnabled);

  if (isAlreadyActive) {
    return;
  }

  if (activeCount < MAX_ACTIVE_PRODUCTS) {
    await activateProduct(prisma, productId);
    return;
  }

  // Pool is full. Compare with the lowest priority active product.
  const lowestActive = await prisma.product.findFirst({
    where: {
      status: ProductStatus.READY,
      listings: { some: { trackingEnabled: true } }
    },
    orderBy: [
      { priorityScore: 'asc' },
      { modelYear: 'asc' },
      { createdAt: 'asc' }
    ],
    select: { id: true, priorityScore: true }
  });

  if (lowestActive && priorityScore > lowestActive.priorityScore) {
    await archiveProduct(prisma, lowestActive.id);
    await activateProduct(prisma, productId);
  }
}
