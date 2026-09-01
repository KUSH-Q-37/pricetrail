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

export function isYearEligible(modelYear: number | null, systemDate = new Date()): boolean {
  if (!modelYear) return false;
  
  // Tracking begins on 1 Sept 2026. The logic remains purely dynamic.
  const currentYear = systemDate.getUTCFullYear();
  const previousYear = currentYear - 1;
  return modelYear === currentYear || modelYear === previousYear;
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

  const eligible = isYearEligible(product.modelYear);

  if (!eligible) {
    // If it's currently tracked, we archive it
    if (product.status !== ProductStatus.ARCHIVED && product.listings.some(l => l.trackingEnabled)) {
      await archiveProduct(prisma, productId);
    }
    return;
  }

  // It is eligible. Are we full?
  // Note: Since each product can have up to 2 listings, the 15k limit applies to unique products being tracked.
  // We can count distinct products with trackingEnabled=true.
  const activeCountRows = await prisma.marketplaceListing.groupBy({
    by: ['productId'],
    where: { trackingEnabled: true },
  });
  const activeCount = activeCountRows.length;

  // If tracking is already enabled for any listing, it's already active
  const isAlreadyActive = product.listings.some((l) => l.trackingEnabled);

  if (isAlreadyActive) {
    return;
  }

  if (activeCount < MAX_ACTIVE_PRODUCTS) {
    await activateProduct(prisma, productId);
    return;
  }

  // Pool is full. Compare with the lowest priority active product.
  // We only replace if the new product is strictly better.
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
