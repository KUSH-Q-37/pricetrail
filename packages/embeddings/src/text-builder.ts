export interface EmbeddingTextInput {
  title: string;
  brand?: string;
  modelNumber?: string;
  category?: string;
  attributes?: Record<string, string | number | undefined>;
}

/**
 * Marketplace boilerplate that carries no product identity.
 *
 * This matters more than it looks. Flipkart and Amazon append different
 * marketing phrases to otherwise identical products — "Buy Online at Best
 * Price in India", "with 1 Year Warranty", "Free Delivery". Left in, those
 * tokens are pure noise that pushes the SAME product's two listings apart in
 * vector space, which is precisely the distance the ANN search depends on
 * being small. Stripping them raises recall on the pairs we most want to find.
 */
// ORDER MATTERS: patterns are applied in sequence, so the longest phrase must
// come first. With "at best price" listed before "best price in india", the
// former consumes its substring and leaves a stranded "in india" behind.
const BOILERPLATE = [
  /\bbest\s+price(?:s)?\s+in\s+india\b/gi,
  /\bat\s+best\s+price(?:s)?\b/gi,
  /\bbuy\s+online\b/gi,
  // Standalone catch for whatever the phrase patterns leave behind.
  /\bin\s+india\b/gi,
  /\bfree\s+(?:delivery|shipping)\b/gi,
  /\bcash\s+on\s+delivery\b/gi,
  /\b(?:with|includes?)\s+\d+\s*(?:year|month|yr|mo)s?\s+warranty\b/gi,
  /\bofficial\s+(?:store|seller)\b/gi,
  /\blowest\s+price\b/gi,
  /\bemi\s+available\b/gi,
  /\bno\s+cost\s+emi\b/gi,
  /\bexchange\s+offer\b/gi,
  /\bamazon\.in\b/gi,
  /\bflipkart\.com\b/gi,
];

/**
 * Attribute keys worth embedding, in a fixed order.
 *
 * Ordering is fixed so the same product always produces the same string:
 * `Object.entries` iteration order depends on insertion, so two listings with
 * identical attributes inserted in different orders would otherwise embed to
 * different vectors.
 */
const EMBEDDED_ATTRIBUTE_KEYS = [
  'storage_gb',
  'ram_gb',
  'capacity_l',
  'capacity_kg',
  'capacity_ton',
  'screen_in',
  'star_rating',
  'colour',
] as const;

/**
 * Function words carrying no product identity.
 *
 * These do double duty. Removing prepositions and articles shortens the text,
 * but the real reason is robustness: stripping boilerplate with sequential
 * regexes inevitably strands fragments ("Buy Online **at** Best Price" leaves
 * a dangling "at" once both phrases are removed). Filtering at the token level
 * cleans up whatever the phrase patterns miss, so the output stays stable
 * without needing the pattern list to be exhaustive or perfectly ordered.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'at', 'by', 'for', 'from', 'in', 'of', 'on',
  'to', 'with', 'is', 'are', 'be', 'this', 'that', 'it', 'its',
]);

const ATTRIBUTE_UNITS: Record<string, string> = {
  storage_gb: 'gb storage',
  ram_gb: 'gb ram',
  capacity_l: 'litre',
  capacity_kg: 'kg',
  capacity_ton: 'ton',
  screen_in: 'inch',
  star_rating: 'star',
};

function stripBoilerplate(text: string): string {
  let result = text;
  for (const pattern of BOILERPLATE) result = result.replace(pattern, ' ');
  return result;
}

/**
 * Build the canonical text embedded for a listing.
 *
 * Two goals, in tension:
 *
 *  1. Two listings of the SAME product must land close together, despite
 *     different capitalisation, word order and marketing suffixes.
 *  2. Two listings of DIFFERENT VARIANTS should land at least somewhat apart.
 *
 * Goal 2 is only partially achievable and deliberately not relied upon —
 * "iPhone 15 Pro 128 GB" and "iPhone 15 Pro 256 GB" sit around 0.97 cosine no
 * matter how the text is built. That is why the embedding's job here is
 * CANDIDATE GENERATION (get the true match into the top-K) and the attribute
 * vetoes in packages/matching do the discriminating. Expecting the vector to
 * separate capacity variants is the mistake this architecture avoids.
 *
 * Attributes are still appended because they measurably help recall on
 * accessories and unrelated products, which is the noise the top-K needs to
 * survive.
 */
export function buildEmbeddingText(input: EmbeddingTextInput): string {
  const parts: string[] = [];

  // Brand and model first: they carry the most identity per token, and the
  // model has a fixed 512-token budget that long titles can approach.
  if (input.brand) parts.push(input.brand.toLowerCase().trim());
  if (input.modelNumber) parts.push(input.modelNumber.toLowerCase().trim());

  const title = stripBoilerplate(input.title)
    .toLowerCase()
    // Keep alphanumerics; model numbers such as GL-S292RPZX become separable
    // tokens rather than fusing with neighbouring words.
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (title) parts.push(title);

  if (input.category && input.category !== 'OTHER') {
    parts.push(input.category.toLowerCase().replace(/_/g, ' '));
  }

  if (input.attributes) {
    for (const key of EMBEDDED_ATTRIBUTE_KEYS) {
      const value = input.attributes[key];
      if (value === undefined || value === '') continue;
      const unit = ATTRIBUTE_UNITS[key];
      parts.push(unit ? `${value} ${unit}` : String(value).toLowerCase());
    }
  }

  // De-duplicate: the brand almost always also appears in the title, and
  // repeating a token inflates its weight in the pooled embedding for no
  // reason.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const part of parts.join(' ').split(' ')) {
    if (!part) continue;
    if (STOPWORDS.has(part)) continue;
    if (seen.has(part)) continue;
    seen.add(part);
    deduped.push(part);
  }

  // bge-small truncates at 512 tokens; product text never approaches that,
  // but a runaway scraped title must not silently lose its tail either.
  return deduped.join(' ').slice(0, 1024);
}
