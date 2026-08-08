/**
 * Vector dimension. Fixed at 384 to match `bge-small-en-v1.5` and the
 * `vector(384)` column created in the Phase 2 migration.
 *
 * Changing this is a schema migration AND a full re-embed of every listing,
 * because vectors of different dimensions cannot be compared at all. It is
 * therefore asserted at runtime rather than trusted.
 */
export const EMBEDDING_DIMENSION = 384;

export interface EmbeddingResult {
  vector: number[];
  /** Model identity, stored per row so a model change is detectable. */
  model: string;
}

/**
 * The one method the rest of the system depends on.
 *
 * Deliberately minimal. Phase 1 chose a local ONNX model to avoid a per-call
 * API cost and a network dependency in the daily sweep, but that decision has
 * to stay reversible: if `bge-small` proves too weak for Indian product
 * titles, swapping to Voyage or Jina should be a one-file change, not a
 * refactor of the matching pipeline.
 */
export interface EmbeddingProvider {
  readonly model: string;
  readonly dimension: number;

  /**
   * Embed a batch.
   *
   * Batch-first rather than single-first on purpose: transformer inference is
   * dominated by fixed per-call overhead, so embedding 32 titles in one call
   * is several times faster than 32 separate calls. A single-item API would
   * make the efficient path the awkward one, and the backfill would crawl.
   */
  embed(texts: string[]): Promise<EmbeddingResult[]>;

  /** Release model resources. */
  dispose?(): Promise<void>;
}

export class EmbeddingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EmbeddingError';
  }
}

/**
 * Cosine similarity between two vectors.
 *
 * Both providers return L2-normalised vectors, for which cosine reduces to a
 * dot product — but the full form is computed here anyway. The cost is
 * negligible and it means a provider that forgets to normalise produces a
 * wrong-looking score rather than a silently inflated one.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new EmbeddingError(
      `Cannot compare vectors of different dimensions (${a.length} vs ${b.length})`,
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  if (normA === 0 || normB === 0) return 0;

  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  // Guard against floating-point drift pushing an identical pair to 1.0000001,
  // which would fail a `<= 1` assertion downstream.
  return Math.max(-1, Math.min(1, similarity));
}

/** Format a vector as a pgvector literal: '[0.1,0.2,...]'. */
export function toVectorLiteral(vector: number[]): string {
  if (vector.length !== EMBEDDING_DIMENSION) {
    throw new EmbeddingError(
      `Expected ${EMBEDDING_DIMENSION} dimensions, got ${vector.length}`,
    );
  }
  return `[${vector.join(',')}]`;
}

/** Parse a pgvector literal back into numbers. */
export function fromVectorLiteral(literal: string): number[] {
  const trimmed = literal.trim().replace(/^\[|\]$/g, '');
  if (!trimmed) return [];
  return trimmed.split(',').map((part) => Number(part));
}
