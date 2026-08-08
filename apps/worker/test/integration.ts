/**
 * Phase 10 end-to-end verification against LIVE Postgres.
 *
 * Proves the whole chain: real model -> 384-dim vectors -> pgvector column ->
 * HNSW ANN search -> candidate union -> matching pipeline with a real cosine.
 *
 * Requires the Docker infra to be running.
 *   pnpm --filter @pricetrail/worker test:integration
 */
import { PrismaClient, findSimilarListings } from '@pricetrail/database';
import {
  LocalOnnxEmbeddingProvider,
  buildEmbeddingText,
  cosineSimilarity,
} from '@pricetrail/embeddings';
import { matchProducts, type MatchInput } from '@pricetrail/matching';

import { embedMissingListings } from '../src/jobs/embed-listings';
import { findCandidates } from '../src/jobs/find-candidates';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    failures.push(`  ${name}\n      expected ${e}\n      actual   ${a}`);
  }
}

const section = (title: string) => console.log(`\n=== ${title} ===`);

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const provider = new LocalOnnxEmbeddingProvider();

  try {
    // -----------------------------------------------------------------------
    section('BACKFILL EMBEDDINGS INTO PGVECTOR');
    // -----------------------------------------------------------------------
    const before = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM marketplace_listings WHERE embedding IS NULL
    `;
    console.log(`  listings without embedding: ${before[0]?.count ?? 0}`);

    const result = await embedMissingListings(prisma, provider, { batchSize: 32 });
    console.log(`  embedded ${result.processed} in ${result.durationMs}ms`);

    // READY listings must all be embedded...
    const readyMissing = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count
      FROM marketplace_listings l JOIN products p ON p.id = l.product_id
      WHERE l.embedding IS NULL AND p.status = 'READY'
    `;
    check('every READY listing is embedded', Number(readyMissing[0]?.count ?? -1), 0);

    // ...and PENDING ones must NOT be. Their titles are placeholders
    // ("Amazon product B0XXXX"), and because that template is identical across
    // every pending listing, embedding them makes the ANN search return
    // template similarity instead of product similarity — filling the review
    // queue with pairs a human cannot act on.
    const pendingEmbedded = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count
      FROM marketplace_listings l JOIN products p ON p.id = l.product_id
      WHERE l.embedding IS NOT NULL AND p.status <> 'READY'
    `;
    check('PENDING placeholders are NOT embedded', Number(pendingEmbedded[0]?.count ?? -1), 0);

    // Verify the column really holds 384 dimensions, read back from Postgres.
    const dims = await prisma.$queryRaw<Array<{ dims: number }>>`
      SELECT vector_dims(embedding) AS dims
      FROM marketplace_listings WHERE embedding IS NOT NULL LIMIT 1
    `;
    check('stored vectors are 384-dim', Number(dims[0]?.dims), 384);

    const modelRow = await prisma.$queryRaw<Array<{ embedding_model: string }>>`
      SELECT embedding_model FROM marketplace_listings
      WHERE embedding IS NOT NULL LIMIT 1
    `;
    check('model id persisted', modelRow[0]?.embedding_model, 'Xenova/bge-small-en-v1.5');

    // -----------------------------------------------------------------------
    section('HNSW ANN SEARCH FINDS THE CROSS-PLATFORM TWIN');
    // -----------------------------------------------------------------------
    const seeded = await prisma.marketplaceListing.findMany({
      where: { platform: 'AMAZON' },
      include: { product: true },
      orderBy: { createdAt: 'asc' },
    });

    const amazonIphone = seeded.find((l) => /iphone/i.test(l.title));
    const amazonFridge = seeded.find((l) => /refrigerator/i.test(l.title));

    if (!amazonIphone || !amazonFridge) {
      throw new Error('Seed data missing — run `pnpm db:seed` first');
    }

    for (const listing of [amazonIphone, amazonFridge]) {
      const text = buildEmbeddingText({
        title: listing.title,
        brand: listing.brand ?? undefined,
        category: listing.product.category,
        attributes: listing.product.attributes as Record<string, string | number>,
      });
      const [embedded] = await provider.embed([text]);

      const neighbours = await findSimilarListings(prisma, {
        vector: embedded!.vector,
        limit: 5,
        excludeListingId: listing.id,
        excludePlatform: 'AMAZON',
      });

      const top = neighbours[0];
      console.log(`  "${listing.title.slice(0, 45)}..."`);
      console.log(`    -> top match: "${top?.title.slice(0, 45)}..." (${top?.similarity.toFixed(4)})`);

      check(
        `[${listing.title.slice(0, 22)}] top ANN hit is the Flipkart twin`,
        top?.productId,
        listing.productId,
      );
      check(`[${listing.title.slice(0, 22)}] ANN excludes same platform`, top?.platform, 'FLIPKART');
    }

    // -----------------------------------------------------------------------
    section('CANDIDATE GENERATION (identifier + vector + lexical union)');
    // -----------------------------------------------------------------------
    const candidates = await findCandidates(
      prisma,
      provider,
      {
        id: amazonIphone.id,
        platform: amazonIphone.platform,
        title: amazonIphone.title,
        brand: amazonIphone.brand,
        modelNumber: amazonIphone.modelNumber,
        ean: amazonIphone.ean,
        upc: amazonIphone.upc,
        category: amazonIphone.product.category,
        attributes: amazonIphone.product.attributes as Record<string, string | number>,
      },
      { limitPerSource: 10 },
    );

    console.log(`  ${candidates.length} candidate(s):`);
    for (const candidate of candidates.slice(0, 5)) {
      console.log(
        `    [${candidate.sources.join('+').padEnd(24)}] ${candidate.similarity.toFixed(4)}  ${candidate.title.slice(0, 40)}`,
      );
    }

    check('found at least one candidate', candidates.length > 0, true);
    check('true twin is ranked first', candidates[0]?.productId, amazonIphone.productId);
    // Seed data carries a shared EAN, so the identifier generator must fire.
    check(
      'identifier generator contributed',
      candidates[0]?.sources.includes('IDENTIFIER'),
      true,
    );
    check(
      'multiple generators agree on the top candidate',
      (candidates[0]?.sources.length ?? 0) >= 2,
      true,
    );

    // -----------------------------------------------------------------------
    section('MATCHING PIPELINE WITH A REAL EMBEDDING COSINE');
    // -----------------------------------------------------------------------
    const flipkartTwin = await prisma.marketplaceListing.findFirst({
      where: { productId: amazonIphone.productId, platform: 'FLIPKART' },
      include: { product: true },
    });
    if (!flipkartTwin) throw new Error('Flipkart twin missing from seed');

    const toMatchInput = (
      listing: typeof amazonIphone,
    ): MatchInput => ({
      platform: listing.platform as 'AMAZON' | 'FLIPKART',
      externalId: listing.externalId,
      title: listing.title,
      brand: listing.brand ?? undefined,
      modelNumber: listing.modelNumber ?? undefined,
      ean: listing.ean ?? undefined,
      upc: listing.upc ?? undefined,
      category: listing.product.category as MatchInput['category'],
      attributes: listing.product.attributes as Record<string, string | number>,
      priceMinor: listing.currentPriceMinor ?? undefined,
    });

    const [vecA, vecB] = await provider.embed([
      buildEmbeddingText({
        title: amazonIphone.title,
        brand: amazonIphone.brand ?? undefined,
        attributes: amazonIphone.product.attributes as Record<string, string | number>,
      }),
      buildEmbeddingText({
        title: flipkartTwin.title,
        brand: flipkartTwin.brand ?? undefined,
        attributes: flipkartTwin.product.attributes as Record<string, string | number>,
      }),
    ]);

    const realCosine = cosineSimilarity(vecA!.vector, vecB!.vector);
    console.log(`  real embedding cosine: ${realCosine.toFixed(4)}`);

    const withEmbedding = matchProducts(
      toMatchInput(amazonIphone),
      toMatchInput(flipkartTwin as typeof amazonIphone),
      { semanticSimilarity: realCosine },
    );
    const withoutEmbedding = matchProducts(
      toMatchInput(amazonIphone),
      toMatchInput(flipkartTwin as typeof amazonIphone),
    );

    console.log(`  decision (with embedding)   : ${withEmbedding.decision} @ ${withEmbedding.confidence}`);
    console.log(`  decision (lexical fallback) : ${withoutEmbedding.decision} @ ${withoutEmbedding.confidence}`);

    check('seeded twin auto-confirms', withEmbedding.decision, 'AUTO_CONFIRMED');
    check('real cosine is high for a true pair', realCosine > 0.9, true);
    check('no veto fired', withEmbedding.vetoReason, undefined);
    check(
      'semantic layer reports the embedding was used',
      withEmbedding.semantic.evidence[0]?.includes('embedding cosine'),
      true,
    );

    // -----------------------------------------------------------------------
    section('THE CAP LIFTS: embeddings unlock auto-confirm without a barcode');
    // -----------------------------------------------------------------------
    {
      // Strip identifiers so the barcode floor cannot carry the decision, and
      // confirm the embedding is what moves it past the threshold.
      const stripped = (listing: typeof amazonIphone): MatchInput => ({
        ...toMatchInput(listing),
        ean: undefined,
        upc: undefined,
      });

      const lexical = matchProducts(stripped(amazonIphone), stripped(flipkartTwin as typeof amazonIphone));
      const embedded = matchProducts(
        stripped(amazonIphone),
        stripped(flipkartTwin as typeof amazonIphone),
        { semanticSimilarity: realCosine },
      );

      console.log(`  no barcode, lexical  : ${lexical.decision} @ ${lexical.confidence}`);
      console.log(`  no barcode, embedded : ${embedded.decision} @ ${embedded.confidence}`);

      check('lexical fallback stays capped', lexical.decision, 'NEEDS_REVIEW');
      check('embedding raises confidence', embedded.confidence > lexical.confidence, true);
    }
  } finally {
    await provider.dispose?.();
    await prisma.$disconnect();
  }

  console.log(`\n${'='.repeat(60)}`);
  if (failed > 0) console.log(`FAILURES:\n${failures.join('\n')}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((error: unknown) => {
  console.error('\nintegration test threw:', error);
  process.exit(1);
});
