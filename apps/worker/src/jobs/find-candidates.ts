import {
  findIdentifierCandidates,
  findLexicalCandidates,
  findSimilarListings,
  type AnnCandidate,
  type PrismaClient,
} from '@pricetrail/database';
import { buildEmbeddingText, type EmbeddingProvider } from '@pricetrail/embeddings';
import { normalizeTitle } from '@pricetrail/marketplace';

export type CandidateSource = 'IDENTIFIER' | 'VECTOR' | 'LEXICAL';

export interface Candidate extends AnnCandidate {
  sources: CandidateSource[];
}

export interface CandidateSourceListing {
  id: string;
  platform: string;
  title: string;
  brand?: string | null;
  modelNumber?: string | null;
  ean?: string | null;
  upc?: string | null;
  category?: string;
  attributes?: Record<string, string | number | undefined>;
}

/**
 * STAGE A — candidate generation.
 *
 * The reason this stage exists at all: scoring is O(n²). At 100 000 listings
 * that is 10^10 pairs, which is not a tuning problem but an impossibility.
 * Stage A is recall-oriented and cheap — get the true match into a list of
 * ~50 — and Stage B (packages/matching) is precision-oriented and expensive.
 *
 * Three independent generators, unioned, because each fails differently:
 *
 *   IDENTIFIER  conclusive when present, absent on most listings
 *   VECTOR      strong on paraphrase ("Bluetooth Headset" vs "Wireless
 *               Headphones"), weak on rare alphanumeric tokens which get
 *               diluted across the pooled embedding
 *   LEXICAL     the exact inverse — reliably finds a shared "GL-S292RPZX"
 *               that the embedding blurred, useless on paraphrase
 *
 * Running only the vector search would miss products whose titles are worded
 * identically but whose model numbers differ; running only trigram would miss
 * every cross-marketplace rewording. The union is what makes recall acceptable.
 */
export async function findCandidates(
  prisma: PrismaClient,
  provider: EmbeddingProvider,
  source: CandidateSourceListing,
  options: { limitPerSource?: number; embedding?: number[] } = {},
): Promise<Candidate[]> {
  const limitPerSource = options.limitPerSource ?? 20;

  // Only ever look at the OTHER marketplace: we want the cross-platform twin,
  // and same-platform neighbours are variants of the listing we started from.
  const excludePlatform = source.platform;

  const identifierHits = await findIdentifierCandidates(prisma, {
    ean: source.ean ?? null,
    upc: source.upc ?? null,
    modelNumber: source.modelNumber ?? null,
    brand: source.brand ?? null,
    excludeListingId: source.id,
    excludePlatform,
    limit: limitPerSource,
  });

  let vector = options.embedding;
  if (!vector) {
    const text = buildEmbeddingText({
      title: source.title,
      brand: source.brand ?? undefined,
      modelNumber: source.modelNumber ?? undefined,
      category: source.category,
      attributes: source.attributes,
    });
    const [embedded] = await provider.embed([text]);
    vector = embedded?.vector;
  }

  const vectorHits = vector
    ? await findSimilarListings(prisma, {
        vector,
        limit: limitPerSource,
        excludeListingId: source.id,
        excludePlatform,
        // Below this the candidate is noise; scoring it wastes work and
        // widens the review queue for nothing.
        minSimilarity: 0.5,
      })
    : [];

  const lexicalHits = await findLexicalCandidates(prisma, {
    normalizedTitle: normalizeTitle(source.title),
    limit: limitPerSource,
    excludeListingId: source.id,
    excludePlatform,
    minSimilarity: 0.2,
  });

  // Union, keeping the highest similarity seen and recording every generator
  // that surfaced the row. A candidate found by two independent generators is
  // meaningfully stronger evidence than one found by either alone, and the
  // admin review UI shows this.
  const merged = new Map<string, Candidate>();

  const add = (hits: AnnCandidate[], sourceName: CandidateSource): void => {
    for (const hit of hits) {
      const existing = merged.get(hit.listingId);
      if (existing) {
        if (!existing.sources.includes(sourceName)) existing.sources.push(sourceName);
        existing.similarity = Math.max(existing.similarity, hit.similarity);
      } else {
        merged.set(hit.listingId, { ...hit, sources: [sourceName] });
      }
    }
  };

  add(identifierHits, 'IDENTIFIER');
  add(vectorHits, 'VECTOR');
  add(lexicalHits, 'LEXICAL');

  return [...merged.values()].sort((a, b) => {
    // Identifier hits first regardless of similarity — a shared GTIN is
    // conclusive and must never be pushed out of the list by a high cosine.
    const aId = a.sources.includes('IDENTIFIER') ? 1 : 0;
    const bId = b.sources.includes('IDENTIFIER') ? 1 : 0;
    if (aId !== bId) return bId - aId;
    if (a.sources.length !== b.sources.length) return b.sources.length - a.sources.length;
    return b.similarity - a.similarity;
  });
}
