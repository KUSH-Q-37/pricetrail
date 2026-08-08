/**
 * Money is INTEGER minor units (paise) everywhere past this boundary.
 * Int32 caps at 2,147,483,647 paise = Rs 21,474,836.47.
 */
export const MAX_PRICE_MINOR = 2_147_483_647;

/**
 * First numeric token in a string, allowing digit grouping and up to two
 * decimal places.
 *
 * Anchoring on the FIRST match matters: Amazon's `.a-price` renders the value
 * twice — once in `.a-offscreen` for screen readers and once split across
 * `.a-price-whole` / `.a-price-fraction` for sighted users. A careless
 * `.text()` over the container yields "Rs 1,29,999.00Rs 1,29,999.00", and
 * naively stripping non-digits from that produces 12999900129999.00 — a price
 * ten orders of magnitude too large that still parses as a valid number.
 */
const FIRST_NUMBER = /(\d[\d,\s]*(?:\.\d{1,2})?)/;

/**
 * Parse an Indian-format price string into paise.
 *
 * Handles "₹1,29,999.00", "Rs. 1,299", "1,29,999", "₹ 1,29,999.00" and the
 * doubled-value case above. Returns undefined for anything it cannot read —
 * never a partial guess, because a wrong price is written into permanent
 * history and silently corrupts every chart derived from it.
 *
 * Note that Indian lakh grouping (1,29,999) and Western grouping (129,999)
 * both reduce to the same digits once separators are removed, so no
 * locale-specific grouping logic is needed. The decimal separator is always
 * "." on amazon.in and flipkart.com.
 */
export function parsePriceToMinor(input: string | null | undefined): number | undefined {
  if (!input) return undefined;

  // Normalise the currency-adjacent whitespace Amazon emits (NBSP, thin space)
  // before pattern matching.
  const cleaned = input.replace(/[   ]/g, ' ').trim();
  if (!cleaned) return undefined;

  const match = FIRST_NUMBER.exec(cleaned);
  if (!match?.[1]) return undefined;

  const token = match[1].replace(/[,\s]/g, '');
  if (!token || token === '.') return undefined;

  // String arithmetic rather than parseFloat * 100: 1299.99 * 100 is
  // 129998.99999999999 in IEEE-754, and rounding hides the class of bug
  // rather than removing it.
  const [rupeesPart, fractionPart = ''] = token.split('.');
  if (!rupeesPart || !/^\d+$/.test(rupeesPart)) return undefined;
  if (fractionPart && !/^\d{1,2}$/.test(fractionPart)) return undefined;

  const rupees = Number(rupeesPart);
  const paise = Number(fractionPart.padEnd(2, '0'));

  if (!Number.isSafeInteger(rupees)) return undefined;

  const total = rupees * 100 + paise;

  // Zero is not a legitimate retail price; it is what a failed parse or an
  // "unavailable" page looks like.
  if (total <= 0 || total > MAX_PRICE_MINOR) return undefined;

  return total;
}

/**
 * Discount percentage from MRP and selling price.
 *
 * Returns undefined rather than 0 when there is no genuine discount, so the
 * UI can distinguish "no offer" from "0% off".
 */
export function computeDiscountPercent(
  priceMinor: number | undefined,
  mrpMinor: number | undefined,
): number | undefined {
  if (!priceMinor || !mrpMinor) return undefined;
  if (mrpMinor <= priceMinor) return undefined;

  const percent = Math.round(((mrpMinor - priceMinor) / mrpMinor) * 100);
  return percent > 0 && percent < 100 ? percent : undefined;
}

/**
 * Parse an explicit discount label such as "-33%" or "33% off".
 * Used only as a cross-check; the computed value from MRP is authoritative.
 */
export function parseDiscountPercent(
  input: string | null | undefined,
): number | undefined {
  if (!input) return undefined;
  const match = /(\d{1,2})\s*%/.exec(input);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return value > 0 && value < 100 ? value : undefined;
}
