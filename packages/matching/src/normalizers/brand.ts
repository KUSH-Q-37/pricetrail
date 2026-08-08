/**
 * Brand aliases.
 *
 * Marketplaces spell the same manufacturer differently — Amazon shows
 * "Apple", Flipkart shows "APPLE", the spec table says "Apple Inc.", and
 * appliance listings use "LG Electronics". Since brand mismatch is a HARD
 * VETO, a normalisation gap does not merely lower a score: it rejects a
 * genuine pair outright. This map is therefore load-bearing.
 */
const BRAND_ALIASES: Record<string, string> = {
  apple: 'apple',
  'apple inc': 'apple',
  'apple india': 'apple',

  samsung: 'samsung',
  'samsung electronics': 'samsung',
  'samsung india': 'samsung',

  lg: 'lg',
  'lg electronics': 'lg',
  'lg india': 'lg',

  sony: 'sony',
  'sony india': 'sony',

  oneplus: 'oneplus',
  'one plus': 'oneplus',

  xiaomi: 'xiaomi',
  mi: 'xiaomi',
  redmi: 'redmi',
  poco: 'poco',

  realme: 'realme',
  oppo: 'oppo',
  vivo: 'vivo',
  iqoo: 'iqoo',
  motorola: 'motorola',
  moto: 'motorola',
  nothing: 'nothing',
  google: 'google',
  asus: 'asus',
  acer: 'acer',
  lenovo: 'lenovo',
  hp: 'hp',
  'hewlett packard': 'hp',
  dell: 'dell',
  msi: 'msi',
  whirlpool: 'whirlpool',
  godrej: 'godrej',
  haier: 'haier',
  bosch: 'bosch',
  ifb: 'ifb',
  voltas: 'voltas',
  daikin: 'daikin',
  'blue star': 'bluestar',
  bluestar: 'bluestar',
  panasonic: 'panasonic',
  boat: 'boat',
  jbl: 'jbl',
  sennheiser: 'sennheiser',
  bose: 'bose',
};

/** Marketing suffixes that carry no identity. */
const NOISE = /\b(india|electronics|inc|ltd|limited|pvt|private|corporation|corp|co|company|store|official|brand)\b/g;

/**
 * Canonical brand token, or undefined when nothing usable remains.
 *
 * Returning undefined rather than an empty string matters: the veto only
 * fires on a CONFIRMED mismatch, and "no brand on either side" must not be
 * mistaken for "two different brands".
 */
export function normalizeBrand(input: string | undefined | null): string | undefined {
  if (!input) return undefined;

  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return undefined;

  const alias = BRAND_ALIASES[cleaned];
  if (alias) return alias;

  // Unknown brand: collapse whitespace so "Blue Star" and "BlueStar" agree.
  const collapsed = cleaned.replace(/\s+/g, '');
  return BRAND_ALIASES[collapsed] ?? collapsed;
}

/**
 * Compare two brands.
 *
 * Returns 'unknown' when either side is missing — the caller must NOT treat
 * that as a mismatch.
 */
export function compareBrands(
  a: string | undefined,
  b: string | undefined,
): 'match' | 'mismatch' | 'unknown' {
  const left = normalizeBrand(a);
  const right = normalizeBrand(b);

  if (!left || !right) return 'unknown';
  if (left === right) return 'match';

  // Sub-brands: Xiaomi sells Redmi and Poco, and a listing may name either the
  // parent or the sub-brand. Treating those as a mismatch would reject real
  // pairs, so they are explicitly related rather than equal.
  const families: string[][] = [['xiaomi', 'redmi', 'poco', 'mi']];
  for (const family of families) {
    if (family.includes(left) && family.includes(right)) return 'match';
  }

  return 'mismatch';
}
