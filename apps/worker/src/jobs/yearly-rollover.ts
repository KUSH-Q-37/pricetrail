import { PrismaClient } from '@pricetrail/database';
import { isYearEligible, archiveProduct } from './lifecycle-manager';

export interface RolloverResult {
  archivedCount: number;
}

/**
 * Idempotent yearly rollover job.
 * 
 * - Determines the active tracking window (Current Year + Previous Year).
 * - Finds products older than the Previous Year that are still being tracked.
 * - Archives them by setting trackingEnabled = false.
 * - Existing history remains, and 15-month deletion occurs via separate sweep.
 */
export async function runYearlyRollover(
  prisma: PrismaClient,
): Promise<RolloverResult> {
  const systemDate = new Date();
  
  // Find all products that have active tracking.
  // Note: we fetch products where any listing is trackingEnabled.
  const activeProducts = await prisma.product.findMany({
    where: {
      listings: { some: { trackingEnabled: true } }
    },
    select: {
      id: true,
      modelYear: true,
    }
  });

  let archivedCount = 0;

  for (const p of activeProducts) {
    if (!isYearEligible(p.modelYear, systemDate)) {
      await archiveProduct(prisma, p.id);
      archivedCount++;
    }
  }

  // The active pool is now theoretically smaller. 
  // Any newly discovered items going forward will fill it if below 15K.
  // Existing pending items could technically be evaluated here, but normal discovery will also do that.
  return { archivedCount };
}
