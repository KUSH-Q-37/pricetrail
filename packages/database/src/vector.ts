import { Prisma, type PrismaClient } from '../generated/client';

/**
 * pgvector access.
 *
 * Everything here is raw SQL because Prisma has no vector type — the column is
 * declared `Unsupported("vector(384)")`, which keeps it in migrations while
 * excluding it from the generated client. This module is the ONLY place that
 * writes or reads it, so the `::vector` casts and HNSW query shapes live in
 * one file rather than being scattered across services.
 */

export const EMBEDDING_DIMENSION = 384;

export interface AnnCandidate {
  listingId: string;
  productId: string;
  platform: string;
  externalId: string;
  title: string;
  /** 0..1, higher is closer. pgvector returns DISTANCE; this is 1 - distance. */
  similarity: number;
}

function assertDimension(vector: number[]): void {
  if (vector.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSION}-dimensional vector, got ${vector.length}`,
    );
  }
}

/**
 * Serialise to a pgvector literal.
 *
 * Non-finite values are rejected rather than serialised: JSON/Postgres would
 * receive `NaN` or `Infinity`, and a single such value poisons the HNSW index
 * for every subsequent query — distances against it are undefined and the
 * graph traversal silently degrades.
 */
function toLiteral(vector: number[]): string {
  assertDimension(vector);
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i]!)) {
      throw new Error(`Vector contains a non-finite value at index ${i}`);
    }
  }
  return `[${vector.join(',')}]`;
}

/** Write one listing's embedding. */
export async function setListingEmbedding(
  prisma: PrismaClient,
  listingId: string,
  vector: number[],
  model: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE marketplace_listings
    SET embedding = ${toLiteral(vector)}::vector,
        embedding_model = ${model},
        embedding_updated_at = NOW()
    WHERE id = ${listingId}::uuid
  `;
}

/**
 * Write many embeddings in one statement.
 *
 * A loop of single UPDATEs costs one network round trip each; at backfill
 * scale that dominates the runtime completely. `unnest` turns the whole batch
 * into a single set-based update.
 */
export async function setListingEmbeddings(
  prisma: PrismaClient,
  rows: Array<{ listingId: string; vector: number[]; model: string }>,
): Promise<number> {
  if (rows.length === 0) return 0;

  const ids = rows.map((row) => row.listingId);
  const vectors = rows.map((row) => toLiteral(row.vector));
  const models = rows.map((row) => row.model);

  return prisma.$executeRaw`
    UPDATE marketplace_listings AS l
    SET embedding = data.vec::vector,
        embedding_model = data.model,
        embedding_updated_at = NOW()
    FROM (
      SELECT
        unnest(${ids}::uuid[])  AS id,
        unnest(${vectors}::text[]) AS vec,
        unnest(${models}::text[])  AS model
    ) AS data
    WHERE l.id = data.id
  `;
}

/**
 * Listings still needing an embedding.
 *
 * Served by the partial index `marketplace_listings_missing_embedding_idx`
 * (WHERE embedding IS NULL), so this stays cheap even when the table is large
 * and almost fully embedded.
 */
export async function findListingsMissingEmbedding(
  prisma: PrismaClient,
  limit = 200,
): Promise<Array<{ id: string; title: string; brand: string | null; category: string; attributes: unknown }>> {
  return prisma.$queryRaw`
    SELECT l.id, l.title, l.brand, p.category::text AS category, p.attributes
    FROM marketplace_listings l
    JOIN products p ON p.id = l.product_id
    WHERE l.embedding IS NULL
      -- PENDING products carry a placeholder title ("Amazon product B0XXXX")
      -- because no fetcher has filled them in yet. Embedding those is worse
      -- than useless: the placeholder TEMPLATE is identical across every
      -- pending listing, so they all land near each other in vector space and
      -- the ANN search returns template similarity rather than product
      -- similarity. See the same guard on every candidate generator below.
      AND p.status = 'READY'
    ORDER BY l.created_at
    LIMIT ${limit}
  `;
}

/**
 * Approximate nearest-neighbour search — matching Stage A2.
 *
 * `<=>` is pgvector's cosine DISTANCE operator (0 = identical, 2 = opposite),
 * and it is also what the HNSW index was built for via `vector_cosine_ops`.
 * The ORDER BY must use that exact operator or Postgres silently falls back to
 * a sequential scan over every row — the query still returns correct results,
 * which is precisely why this mistake survives code review and only shows up
 * as a latency cliff in production.
 *
 * `excludePlatform` restricts results to the OTHER marketplace: we are looking
 * for the cross-platform twin, and same-platform neighbours are all variants
 * of the same listing.
 */
export async function findSimilarListings(
  prisma: PrismaClient,
  options: {
    vector: number[];
    limit?: number;
    excludeListingId?: string;
    excludePlatform?: string;
    /** Minimum similarity (0..1). Filters obvious noise before scoring. */
    minSimilarity?: number;
    /**
     * HNSW candidate-list size. Higher = better recall, slower query. The
     * pgvector default of 40 is tuned for generic workloads; 100 is a
     * reasonable trade here because a missed candidate means a product is
     * never matched at all.
     */
    efSearch?: number;
  },
): Promise<AnnCandidate[]> {
  const {
    vector,
    limit = 20,
    excludeListingId,
    excludePlatform,
    minSimilarity = 0,
    efSearch = 100,
  } = options;

  const literal = toLiteral(vector);

  // Session-scoped, so it applies to the query below without changing the
  // server default for other connections.
  await prisma.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${Number(efSearch)}`);

  const rows = await prisma.$queryRaw<
    Array<{
      listing_id: string;
      product_id: string;
      platform: string;
      external_id: string;
      title: string;
      distance: number;
    }>
  >`
    SELECT
      l.id           AS listing_id,
      l.product_id   AS product_id,
      l.platform::text AS platform,
      l.external_id  AS external_id,
      l.title        AS title,
      (l.embedding <=> ${literal}::vector) AS distance
    FROM marketplace_listings l
    JOIN products p ON p.id = l.product_id
    WHERE l.embedding IS NOT NULL
      -- Never propose a product whose data has not been fetched yet.
      AND p.status = 'READY'
      AND (${excludeListingId ?? null}::uuid IS NULL OR l.id <> ${excludeListingId ?? null}::uuid)
      AND (${excludePlatform ?? null}::text IS NULL OR l.platform::text <> ${excludePlatform ?? null}::text)
    ORDER BY l.embedding <=> ${literal}::vector
    LIMIT ${limit}
  `;

  return rows
    .map((row) => ({
      listingId: row.listing_id,
      productId: row.product_id,
      platform: row.platform,
      externalId: row.external_id,
      title: row.title,
      // Cosine distance in [0,2] -> similarity in [-1,1].
      similarity: 1 - Number(row.distance),
    }))
    .filter((candidate) => candidate.similarity >= minSimilarity);
}

/**
 * Lexical candidates via pg_trgm — matching Stage A3.
 *
 * Complements the vector search rather than duplicating it. Embeddings are
 * strong on paraphrase but weak on rare alphanumeric tokens; trigram
 * similarity is the opposite, and reliably finds a shared model number like
 * "GL-S292RPZX" that the embedding may have diluted across its context.
 */
export async function findLexicalCandidates(
  prisma: PrismaClient,
  options: {
    normalizedTitle: string;
    limit?: number;
    excludeListingId?: string;
    excludePlatform?: string;
    minSimilarity?: number;
  },
): Promise<AnnCandidate[]> {
  const {
    normalizedTitle,
    limit = 20,
    excludeListingId,
    excludePlatform,
    minSimilarity = 0.2,
  } = options;

  const rows = await prisma.$queryRaw<
    Array<{
      listing_id: string;
      product_id: string;
      platform: string;
      external_id: string;
      title: string;
      sim: number;
    }>
  >`
    SELECT
      l.id             AS listing_id,
      l.product_id     AS product_id,
      l.platform::text AS platform,
      l.external_id    AS external_id,
      l.title          AS title,
      similarity(l.normalized_title, ${normalizedTitle}) AS sim
    FROM marketplace_listings l
    JOIN products p ON p.id = l.product_id
    WHERE l.normalized_title % ${normalizedTitle}
      AND p.status = 'READY'
      AND (${excludeListingId ?? null}::uuid IS NULL OR l.id <> ${excludeListingId ?? null}::uuid)
      AND (${excludePlatform ?? null}::text IS NULL OR l.platform::text <> ${excludePlatform ?? null}::text)
    ORDER BY similarity(l.normalized_title, ${normalizedTitle}) DESC
    LIMIT ${limit}
  `;

  return rows
    .map((row) => ({
      listingId: row.listing_id,
      productId: row.product_id,
      platform: row.platform,
      externalId: row.external_id,
      title: row.title,
      similarity: Number(row.sim),
    }))
    .filter((candidate) => candidate.similarity >= minSimilarity);
}

/**
 * Exact identifier candidates — matching Stage A1.
 *
 * Cheapest and most decisive of the three generators: a shared GTIN is
 * conclusive, so this runs first and its hits are worth scoring even if the
 * other generators never surface them.
 */
export async function findIdentifierCandidates(
  prisma: PrismaClient,
  options: {
    ean?: string | null;
    upc?: string | null;
    modelNumber?: string | null;
    brand?: string | null;
    excludeListingId?: string;
    excludePlatform?: string;
    limit?: number;
  },
): Promise<AnnCandidate[]> {
  const { ean, upc, modelNumber, brand, excludeListingId, excludePlatform, limit = 20 } = options;

  if (!ean && !upc && !modelNumber) return [];

  const rows = await prisma.$queryRaw<
    Array<{
      listing_id: string;
      product_id: string;
      platform: string;
      external_id: string;
      title: string;
    }>
  >`
    SELECT l.id AS listing_id, l.product_id, l.platform::text AS platform,
           l.external_id, l.title
    FROM marketplace_listings l
    JOIN products p ON p.id = l.product_id
    WHERE p.status = 'READY' AND (
        (${ean ?? null}::text IS NOT NULL AND (l.ean = ${ean ?? null} OR l.upc = ${ean ?? null}))
     OR (${upc ?? null}::text IS NOT NULL AND (l.ean = ${upc ?? null} OR l.upc = ${upc ?? null}))
     OR (
          ${modelNumber ?? null}::text IS NOT NULL
          AND l.model_number = ${modelNumber ?? null}
          -- Model numbers are only unique WITHIN a brand: "A3102" could
          -- plausibly belong to two manufacturers, so a brand match is
          -- required alongside it.
          AND (${brand ?? null}::text IS NULL OR lower(l.brand) = lower(${brand ?? null}))
        )
    )
      AND (${excludeListingId ?? null}::uuid IS NULL OR l.id <> ${excludeListingId ?? null}::uuid)
      AND (${excludePlatform ?? null}::text IS NULL OR l.platform::text <> ${excludePlatform ?? null}::text)
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    listingId: row.listing_id,
    productId: row.product_id,
    platform: row.platform,
    externalId: row.external_id,
    title: row.title,
    // Identifier hits carry no graded score; the matching pipeline decides.
    similarity: 1,
  }));
}

export { Prisma };
