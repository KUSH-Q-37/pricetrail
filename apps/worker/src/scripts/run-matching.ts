/**
 * Score every embedded listing against its cross-platform candidates and
 * persist the verdicts to product_matches.
 *
 *   pnpm --filter @pricetrail/worker match:run
 *
 * Idempotent: matches are upserted on the canonical (listing_a, listing_b)
 * pair, so re-running re-scores rather than duplicating.
 */
import { PrismaClient } from '@pricetrail/database';
import { LocalOnnxEmbeddingProvider } from '@pricetrail/embeddings';

import { matchListing } from '../jobs/match-listings';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const provider = new LocalOnnxEmbeddingProvider();

  try {
    const listings = await prisma.marketplaceListing.findMany({
      // The candidate generators filter the TARGET side to READY products;
      // the source side has to be filtered here too. A PENDING listing has a
      // placeholder title and no attributes, so scoring it produces review
      // items a human cannot act on.
      where: { platform: 'AMAZON', product: { status: 'READY' } },
      select: { id: true, title: true },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`scoring ${listings.length} Amazon listing(s) against Flipkart...\n`);

    const totals = { scanned: 0, scored: 0, autoConfirmed: 0, needsReview: 0, rejected: 0 };

    for (const listing of listings) {
      const result = await matchListing(prisma, provider, listing.id);
      totals.scanned += result.scanned;
      totals.scored += result.scored;
      totals.autoConfirmed += result.autoConfirmed;
      totals.needsReview += result.needsReview;
      totals.rejected += result.rejected;

      console.log(
        `  ${listing.title.slice(0, 44).padEnd(44)} candidates=${result.scanned} ` +
          `confirmed=${result.autoConfirmed} review=${result.needsReview} rejected=${result.rejected}`,
      );
    }

    console.log(
      `\ntotal: ${totals.scored} pair(s) scored — ` +
        `${totals.autoConfirmed} auto-confirmed, ${totals.needsReview} awaiting review, ${totals.rejected} rejected`,
    );
  } finally {
    await provider.dispose?.();
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error('matching run failed:', error);
  process.exitCode = 1;
});
