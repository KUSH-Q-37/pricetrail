import {
  EMBEDDING_DIMENSION,
  EmbeddingError,
  type EmbeddingProvider,
  type EmbeddingResult,
} from './provider';

export interface LocalOnnxOptions {
  /** HuggingFace model id. Must produce 384-dimensional vectors. */
  model?: string;
  /**
   * Quantisation. 'q8' is ~4x smaller and several times faster on CPU, at a
   * small accuracy cost that does not matter for candidate generation — we
   * need the true match inside the top-K, not a precise cosine.
   */
  dtype?: 'fp32' | 'q8';
  /** Sentences per inference call. */
  batchSize?: number;
  /** Local model cache directory. */
  cacheDir?: string;
}

const DEFAULT_MODEL = 'Xenova/bge-small-en-v1.5';

/**
 * Local ONNX embedding provider.
 *
 * `bge-small-en-v1.5`, 384 dimensions, running on CPU in-process via
 * transformers.js. The Phase 1 reasoning for choosing it over 768-dim
 * `bge-base`: product titles are short, the accuracy delta is small, and 384
 * dims halve both the column width and the HNSW index size — which is the
 * thing that actually has to stay in memory.
 *
 * Running locally rather than calling a hosted API means the daily sweep has
 * no per-call cost and no third-party availability dependency. The trade is a
 * one-time ~30 MB model download and ~200 MB of process memory while loaded.
 *
 * The model is loaded LAZILY and cached: constructing this class is free, so
 * a worker that never embeds anything never pays for it.
 */
export class LocalOnnxEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimension = EMBEDDING_DIMENSION;

  private pipelinePromise: Promise<unknown> | undefined;
  private readonly dtype: 'fp32' | 'q8';
  private readonly batchSize: number;
  private readonly cacheDir: string | undefined;

  constructor(options: LocalOnnxOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.dtype = options.dtype ?? 'q8';
    this.batchSize = options.batchSize ?? 16;
    this.cacheDir = options.cacheDir;
  }

  private async getPipeline(): Promise<
    (texts: string[], options: Record<string, unknown>) => Promise<{
      tolist(): number[][];
    }>
  > {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        // Dynamic import so merely importing this package does not pull in
        // ~200 MB of ONNX runtime. Only the code path that embeds pays.
        const transformers = await import('@huggingface/transformers');

        if (this.cacheDir) {
          transformers.env.cacheDir = this.cacheDir;
        }
        // No browser cache in Node, and no telemetry.
        transformers.env.allowLocalModels = true;

        return transformers.pipeline('feature-extraction', this.model, {
          dtype: this.dtype,
        });
      })();
    }

    return this.pipelinePromise as never;
  }

  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    // An empty string embeds to a degenerate vector that is spuriously close
    // to everything. Caught here rather than producing a poisoned index entry.
    const blank = texts.findIndex((text) => !text || !text.trim());
    if (blank >= 0) {
      throw new EmbeddingError(`Cannot embed empty text at index ${blank}`);
    }

    const pipeline = await this.getPipeline();
    const results: EmbeddingResult[] = [];

    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);

      let output: { tolist(): number[][] };
      try {
        output = await pipeline(batch, {
          // CLS pooling is what bge-* models were trained with; mean pooling
          // silently degrades their retrieval quality.
          pooling: 'cls',
          // Normalise so cosine reduces to a dot product, which is also what
          // pgvector's `vector_cosine_ops` index expects.
          normalize: true,
        });
      } catch (error) {
        throw new EmbeddingError(
          `Embedding inference failed for batch at offset ${offset}`,
          { cause: error },
        );
      }

      for (const vector of output.tolist()) {
        if (vector.length !== EMBEDDING_DIMENSION) {
          throw new EmbeddingError(
            `Model ${this.model} produced ${vector.length} dimensions, expected ${EMBEDDING_DIMENSION}. ` +
              `The vector(384) column and HNSW index cannot store this.`,
          );
        }
        results.push({ vector, model: this.model });
      }
    }

    return results;
  }

  async dispose(): Promise<void> {
    this.pipelinePromise = undefined;
  }
}
