import { PrismaClient } from '@pricetrail/database';
import { buildEmbeddingText, type EmbeddingProvider } from '@pricetrail/embeddings';
import { matchProducts, type MatchInput } from '@pricetrail/matching';

import { findCandidates } from './find-candidates';

export interface MatchRunResult {
  scanned: number;
  scored: number;
  autoConfirmed: number;
  needsReview: number;
  rejected: number;
}

/**
 * Score a listing against its cross-platform candidates and persist verdicts.
 *
 * Every outcome is written, REJECTED included. That is deliberate: without a
 * record of the rejection the next run re-scores the same doomed pair, and —
 * more importantly — when someone asks "why isn't my product matched?", the
 * stored veto reason answers it. A silent rejection is unexplainable after
 * the fact.
 */
export async function matchListing(
  prisma: PrismaClient,
  provider: EmbeddingProvider,
  listingId: string,
): Promise<MatchRunResult> {
  const result: MatchRunResult = {
    scanned: 0,
    scored: 0,
    autoConfirmed: 0,
    needsReview: 0,
    rejected: 0,
  };

  const listing = await prisma.marketplaceListing.findUnique({
    where: { id: listingId },
    include: { product: true },
  });
  if (!listing) return result;

  // Guard at the job level too, not just in the calling script: a queue
  // producer in Phase 11 could enqueue a listing the moment it is ingested,
  // long before a fetcher has given it a real title.
  if (listing.product.status !== 'READY') return result;

  const toInput = (row: typeof listing): MatchInput => ({
    platform: row.platform as 'AMAZON' | 'FLIPKART',
    externalId: row.externalId,
    title: row.title,
    brand: row.brand ?? undefined,
    modelNumber: row.modelNumber ?? undefined,
    mpn: row.mpn ?? undefined,
    ean: row.ean ?? undefined,
    upc: row.upc ?? undefined,
    category: row.product.category as MatchInput['category'],
    attributes: row.product.attributes as Record<string, string | number | undefined>,
    priceMinor: row.currentPriceMinor ?? undefined,
  });

  const sourceInput = toInput(listing);
  const [sourceVector] = await provider.embed([
    buildEmbeddingText({
      title: listing.title,
      brand: listing.brand ?? undefined,
      modelNumber: listing.modelNumber ?? undefined,
      category: listing.product.category,
      attributes: listing.product.attributes as Record<string, string | number>,
    }),
  ]);

  const candidates = await findCandidates(
    prisma,
    provider,
    {
      id: listing.id,
      platform: listing.platform,
      title: listing.title,
      brand: listing.brand,
      modelNumber: listing.modelNumber,
      ean: listing.ean,
      upc: listing.upc,
      category: listing.product.category,
      attributes: listing.product.attributes as Record<string, string | number>,
    },
    { embedding: sourceVector?.vector },
  );

  result.scanned = candidates.length;

  for (const candidate of candidates) {
    const other = await prisma.marketplaceListing.findUnique({
      where: { id: candidate.listingId },
      include: { product: true },
    });
    if (!other) continue;

    const verdict = matchProducts(sourceInput, toInput(other), {
      // The vector generator already computed a real cosine; reuse it rather
      // than re-embedding, and let the pipeline's caps lift accordingly.
      semanticSimilarity: candidate.sources.includes('VECTOR')
        ? candidate.similarity
        : undefined,
    });

    // Canonical ordering matches the unique constraint on
    // product_matches(listing_a_id, listing_b_id), so a pair scored from
    // either direction dedupes to one row.
    const [listingAId, listingBId] =
      listing.id <= other.id ? [listing.id, other.id] : [other.id, listing.id];

    await prisma.productMatch.upsert({
      where: { listingAId_listingBId: { listingAId, listingBId } },
      create: {
        listingAId,
        listingBId,
        confidence: verdict.confidence,
        identifierScore: verdict.identifier.score,
        attributeScore: verdict.attribute.score,
        semanticScore: verdict.semantic.score,
        status: verdict.decision,
        vetoReason: verdict.vetoReason ?? null,
        pipelineVersion: verdict.pipelineVersion,
        embeddingModel: provider.model,
      },
      update: {
        confidence: verdict.confidence,
        identifierScore: verdict.identifier.score,
        attributeScore: verdict.attribute.score,
        semanticScore: verdict.semantic.score,
        status: verdict.decision,
        vetoReason: verdict.vetoReason ?? null,
        pipelineVersion: verdict.pipelineVersion,
        embeddingModel: provider.model,
      },
    });

    result.scored++;
    if (verdict.decision === 'AUTO_CONFIRMED') result.autoConfirmed++;
    else if (verdict.decision === 'NEEDS_REVIEW') result.needsReview++;
    else result.rejected++;
  }

  return result;
}
