import type { LayerResult } from '../types';

const STOPWORDS = new Set([
  'the', 'and', 'with', 'for', 'from', 'new', 'buy', 'online', 'best',
  'price', 'india', 'in', 'of', 'a', 'an',
]);

function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** Character trigrams, mirroring what pg_trgm indexes. */
function trigrams(text: string): Set<string> {
  const padded = `  ${text} `;
  const result = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    result.add(padded.slice(i, i + 3));
  }
  return result;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Layer 3 fallback — lexical similarity.
 *
 * A stand-in for the embedding cosine until Phase 10 lands pgvector. It
 * blends token overlap with character trigram similarity, the latter matching
 * what `pg_trgm` computes so this agrees with the database's own candidate
 * ranking.
 *
 * This is deliberately WEAKER evidence than an embedding and the pipeline
 * caps confidence when it is used. Lexical overlap cannot tell that "Natural
 * Titanium" and "Titanium Natural" are the same finish, and — more
 * dangerously — it rates a phone and its case extremely highly, because they
 * share almost every token.
 */
export function lexicalSimilarity(titleA: string, titleB: string): LayerResult {
  const tokensA = new Set(tokenize(titleA));
  const tokensB = new Set(tokenize(titleB));

  if (tokensA.size === 0 || tokensB.size === 0) {
    return { score: 0, applicable: false, evidence: ['titles unusable for comparison'] };
  }

  const tokenScore = jaccard(tokensA, tokensB);
  const trigramScore = jaccard(
    trigrams([...tokensA].sort().join(' ')),
    trigrams([...tokensB].sort().join(' ')),
  );

  // Token overlap carries identity (model numbers, capacities); trigrams
  // absorb spelling and word-order differences.
  const score = tokenScore * 0.6 + trigramScore * 0.4;

  return {
    score: Math.max(0, Math.min(1, score)),
    applicable: true,
    evidence: [
      `lexical similarity ${score.toFixed(3)} (tokens ${tokenScore.toFixed(2)}, trigrams ${trigramScore.toFixed(2)})`,
    ],
  };
}
