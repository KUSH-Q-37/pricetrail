/**
 * Embedding backfill.
 *
 *   pnpm --filter @pricetrail/worker embed:backfill
 *
 * Safe to run repeatedly and safe to interrupt: it only selects rows with a
 * NULL embedding, so a re-run resumes rather than redoing work.
 */
import { PrismaClient } from '@pricetrail/database';
import { LocalOnnxEmbeddingProvider } from '@pricetrail/embeddings';

import { embedMissingListings } from '../jobs/embed-listings';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const provider = new LocalOnnxEmbeddingProvider();

  try {
    console.log('backfilling embeddings (bge-small-en-v1.5, 384-dim)...');

    const result = await embedMissingListings(prisma, provider, {
      batchSize: 32,
      onProgress: (count) => console.log(`  embedded ${count}`),
    });

    console.log(
      `\ndone: ${result.processed} listings in ${result.batches} batch(es), ${result.durationMs}ms`,
    );

    const remaining = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM marketplace_listings WHERE embedding IS NULL
    `;
    console.log(`remaining without embedding: ${remaining[0]?.count ?? 0}`);
  } finally {
    await provider.dispose?.();
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error('backfill failed:', error);
  process.exitCode = 1;
});
