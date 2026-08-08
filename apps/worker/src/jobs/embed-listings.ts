import {
  findListingsMissingEmbedding,
  setListingEmbeddings,
  type PrismaClient,
} from '@pricetrail/database';
import {
  buildEmbeddingText,
  type EmbeddingProvider,
} from '@pricetrail/embeddings';

export interface EmbedResult {
  processed: number;
  batches: number;
  durationMs: number;
}

/**
 * Backfill embeddings for listings that have none.
 *
 * Idempotent and resumable by construction: the query selects only rows
 * WHERE embedding IS NULL (served by a partial index), so a crash halfway
 * through simply means the next run picks up where this one stopped. There is
 * no cursor to persist and no way to double-embed a row.
 */
export async function embedMissingListings(
  prisma: PrismaClient,
  provider: EmbeddingProvider,
  options: { batchSize?: number; maxBatches?: number; onProgress?: (n: number) => void } = {},
): Promise<EmbedResult> {
  const batchSize = options.batchSize ?? 64;
  const maxBatches = options.maxBatches ?? Infinity;
  const started = Date.now();

  let processed = 0;
  let batches = 0;

  while (batches < maxBatches) {
    const rows = await findListingsMissingEmbedding(prisma, batchSize);
    if (rows.length === 0) break;

    const texts = rows.map((row) =>
      buildEmbeddingText({
        title: row.title,
        brand: row.brand ?? undefined,
        category: row.category,
        attributes: (row.attributes ?? {}) as Record<string, string | number | undefined>,
      }),
    );

    const vectors = await provider.embed(texts);

    // Written in one statement rather than a loop of UPDATEs — at backfill
    // scale the per-round-trip cost dominates everything else.
    await setListingEmbeddings(
      prisma,
      rows.map((row, index) => ({
        listingId: row.id,
        vector: vectors[index]!.vector,
        model: vectors[index]!.model,
      })),
    );

    processed += rows.length;
    batches++;
    options.onProgress?.(processed);

    // A short batch means the queue is drained; stop rather than spin.
    if (rows.length < batchSize) break;
  }

  return { processed, batches, durationMs: Date.now() - started };
}
