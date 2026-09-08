import { PrismaClient } from '@pricetrail/database';
import { evaluateProductLifecycle } from './lifecycle-manager';

export interface RolloverResult {
  evaluatedCount: number;
}

/**
 * Idempotent periodic rollover job.
 * 
 * - Scans all currently tracked products.
 * - Passes them through the 2-year rolling window evaluation.
 * - Archives them if they are too old.
 */
export async function runYearlyRollover(
  prisma: PrismaClient,
): Promise<RolloverResult> {
  // Find all products that have active tracking.
  const activeProducts = await prisma.product.findMany({
    where: {
      listings: { some: { trackingEnabled: true } }
    },
    select: {
      id: true,
    }
  });

  for (const p of activeProducts) {
    await evaluateProductLifecycle(prisma, p.id);
  }

  // The active pool is now theoretically smaller. 
  return { evaluatedCount: activeProducts.length };
}
