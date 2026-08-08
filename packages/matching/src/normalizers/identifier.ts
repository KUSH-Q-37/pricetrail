/**
 * Global trade item numbers.
 *
 * EAN-13, UPC-A (12) and GTIN-14 are the same numbering space at different
 * widths — a UPC is an EAN-13 with a leading zero. Amazon commonly reports a
 * UPC where Flipkart reports an EAN for the SAME physical product, so
 * comparing the raw strings finds no match on a pair that is provably
 * identical. Widening both to GTIN-14 before comparing is what turns that into
 * a confirmed identifier match.
 */

/** Standard GS1 mod-10 check digit over the payload (all but the last digit). */
export function gtinCheckDigit(payload: string): number {
  let sum = 0;
  // Weights alternate 3,1,3,1... reading right-to-left from the check position.
  for (let i = payload.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(payload[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Validate a GTIN's check digit.
 *
 * Worth doing because scraped identifiers are frequently truncated model
 * numbers or ASINs that happen to be numeric. A failed check digit is a strong
 * signal the value is not a real barcode, and admitting it would let two
 * unrelated products "match" on a shared piece of garbage.
 */
export function isValidGtin(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return false;

  const payload = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  return gtinCheckDigit(payload) === check;
}

/**
 * Widen any GTIN to 14 digits so different widths of the same code compare
 * equal. Returns undefined when the value is not a valid GTIN.
 */
export function toGtin14(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, '');
  if (!digits || !isValidGtin(digits)) return undefined;
  return digits.padStart(14, '0');
}

export type IdentifierComparison = 'match' | 'mismatch' | 'unknown';

/** Compare two GTIN-family identifiers. */
export function compareGtins(
  a: string | undefined,
  b: string | undefined,
): IdentifierComparison {
  const left = toGtin14(a);
  const right = toGtin14(b);
  if (!left || !right) return 'unknown';
  return left === right ? 'match' : 'mismatch';
}

/**
 * Canonical model-number token.
 *
 * Separators are inconsistent between marketplaces — "GL-S292RPZX",
 * "GL S292RPZX" and "GLS292RPZX" are one model. Stripping non-alphanumerics
 * and upper-casing unifies them.
 *
 * Deliberately conservative about what it accepts: values under 3 characters
 * carry almost no identifying information and would create false matches, and
 * purely numeric values are usually a capacity or a year rather than a model.
 */
export function normalizeModel(input: string | undefined | null): string | undefined {
  if (!input) return undefined;

  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 3) return undefined;
  if (/^\d+$/.test(cleaned) && cleaned.length < 5) return undefined;

  return cleaned;
}

export function compareModels(
  a: string | undefined,
  b: string | undefined,
): IdentifierComparison {
  const left = normalizeModel(a);
  const right = normalizeModel(b);
  if (!left || !right) return 'unknown';
  if (left === right) return 'match';

  // One side may append a regional or storage suffix to the base model
  // ("SM-S928B" vs "SM-S928B/DS"). A containment match is weaker than
  // equality but far better than declaring a mismatch — so it is reported as
  // a match here, and the confidence cap keeps such pairs out of
  // auto-confirmation on their own.
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length >= 5 && longer.startsWith(shorter)) return 'match';

  return 'mismatch';
}
