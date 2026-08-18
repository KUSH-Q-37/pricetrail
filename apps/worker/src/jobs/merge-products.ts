import type { PrismaClient } from '@pricetrail/database';

export interface MergeResult {
  merged: boolean;
  canonicalProductId: string;
  absorbedProductId?: string;
  movedListings?: number;
  reason?: string;
}

/**
 * Bring two listings under one canonical Product after a confirmed match.
 *
 * Why this exists
 * ---------------
 * The matcher scored pairs and wrote a ProductMatch row, and stopped there.
 * Nothing ever reparented the listings, so an AUTO_CONFIRMED Amazon/Flipkart
 * pair remained under two separate Products — and since the history endpoint
 * reads listings via their product, the comparison the whole system exists to
 * draw could never appear on a chart. The match was correct and invisible.
 *
 * Only ever called for AUTO_CONFIRMED. A merge is destructive and effectively
 * irreversible from the application's side, so NEEDS_REVIEW deliberately does
 * not trigger it: an uncertain pair stays as two products and two charts,
 * which is the honest rendering of "we are not sure these are the same thing".
 * A wrong merge presents two different products as one and silently corrupts
 * both their histories — far worse than showing no comparison.
 *
 * Price points survive untouched: they hang off listing_id, so moving a
 * listing carries its whole history with it.
 */
export async function mergeIntoCanonicalProduct(
  prisma: PrismaClient,
  listingAId: string,
  listingBId: string,
): Promise<MergeResult> {
  const [a, b] = await Promise.all([
    prisma.marketplaceListing.findUnique({
      where: { id: listingAId },
      select: { productId: true, product: { select: { createdAt: true } } },
    }),
    prisma.marketplaceListing.findUnique({
      where: { id: listingBId },
      select: { productId: true, product: { select: { createdAt: true } } },
    }),
  ]);

  if (!a || !b) {
    return { merged: false, canonicalProductId: '', reason: 'listing not found' };
  }

  if (a.productId === b.productId) {
    return { merged: false, canonicalProductId: a.productId, reason: 'already canonical' };
  }

  // Deterministic winner: the older product, id as tie-break.
  //
  // Determinism matters more than which one wins. Two workers processing the
  // reciprocal pair concurrently must choose the SAME canonical product, or
  // they reparent into each other and one of the two ends up empty and
  // orphaned. Age is a reasonable choice on its own — the older product is the
  // one more likely to be referenced elsewhere.
  const aIsCanonical =
    a.product.createdAt.getTime() !== b.product.createdAt.getTime()
      ? a.product.createdAt < b.product.createdAt
      : a.productId < b.productId;

  const canonicalId = aIsCanonical ? a.productId : b.productId;
  const absorbedId = aIsCanonical ? b.productId : a.productId;

  const movedListings = await prisma.$transaction(async (tx) => {
    // Users who favourited the absorbed product must keep their favourite, but
    // tracked_products is unique on (user_id, product_id) — a user who
    // favourited BOTH products would collide on update. Move only the rows
    // that would not collide, then delete the rest; the user keeps exactly one
    // favourite for what is now one product.
    const absorbedTracks = await tx.trackedProduct.findMany({
      where: { productId: absorbedId },
      select: { id: true, userId: true },
    });

    for (const track of absorbedTracks) {
      const clash = await tx.trackedProduct.findUnique({
        where: { userId_productId: { userId: track.userId, productId: canonicalId } },
        select: { id: true },
      });

      if (clash) {
        await tx.trackedProduct.delete({ where: { id: track.id } });
      } else {
        await tx.trackedProduct.update({
          where: { id: track.id },
          data: { productId: canonicalId },
        });
      }
    }

    const moved = await tx.marketplaceListing.updateMany({
      where: { productId: absorbedId },
      data: { productId: canonicalId },
    });

    // Safe only because every listing has just been moved off it. Price points
    // cascade from listings, not products, so nothing observed is lost.
    await tx.product.delete({ where: { id: absorbedId } });

    // Both sides now collect daily.
    //
    // A discovered candidate is created untracked, because a search returns
    // guesses and enrolling every guess in daily collection would spend quota
    // on wrong answers forever. Confirmation is the moment that changes: this
    // listing is the same product, so its price belongs on the same chart, and
    // a chart with one line that stops is worse than no counterpart at all.
    await tx.marketplaceListing.updateMany({
      where: { productId: canonicalId },
      data: { trackingEnabled: true },
    });

    return moved.count;
  });

  return {
    merged: true,
    canonicalProductId: canonicalId,
    absorbedProductId: absorbedId,
    movedListings,
  };
}
