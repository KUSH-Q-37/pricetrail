export type Availability =
  | 'IN_STOCK'
  | 'OUT_OF_STOCK'
  | 'LIMITED_STOCK'
  | 'PREORDER'
  | 'DISCONTINUED'
  | 'UNKNOWN';

/**
 * Ordered rules. First match wins, so the most specific phrasings come first.
 *
 * Ordering is the whole design here. "Only 2 left in stock" contains the
 * substring "in stock" — a naive contains-check would classify a nearly
 * sold-out item as freely available. Likewise "Temporarily out of stock"
 * contains "out of stock" but is not the same as "Currently unavailable",
 * and "Available for pre-order" contains "available".
 */
const RULES: Array<{ pattern: RegExp; value: Availability }> = [
  { pattern: /only\s+\d+\s+left/i, value: 'LIMITED_STOCK' },
  { pattern: /few\s+(?:units|items|left)/i, value: 'LIMITED_STOCK' },
  { pattern: /hurry[,!\s]+only/i, value: 'LIMITED_STOCK' },

  { pattern: /pre[\s-]?order/i, value: 'PREORDER' },
  { pattern: /coming\s+soon/i, value: 'PREORDER' },

  { pattern: /no\s+longer\s+available/i, value: 'DISCONTINUED' },
  { pattern: /discontinued/i, value: 'DISCONTINUED' },

  { pattern: /currently\s+unavailable/i, value: 'OUT_OF_STOCK' },
  { pattern: /temporarily\s+out\s+of\s+stock/i, value: 'OUT_OF_STOCK' },
  { pattern: /out\s+of\s+stock/i, value: 'OUT_OF_STOCK' },
  { pattern: /sold\s+out/i, value: 'OUT_OF_STOCK' },
  { pattern: /unavailable/i, value: 'OUT_OF_STOCK' },

  { pattern: /in\s+stock/i, value: 'IN_STOCK' },
  { pattern: /usually\s+dispatch/i, value: 'IN_STOCK' },
  { pattern: /usually\s+ships/i, value: 'IN_STOCK' },
  { pattern: /available/i, value: 'IN_STOCK' },
];

/**
 * Classify a free-text availability string.
 *
 * Returns UNKNOWN rather than guessing IN_STOCK when nothing matches. That
 * asymmetry is deliberate: an unrecognised phrase defaulting to "in stock"
 * would let a delisted product keep recording prices as if it were on sale.
 */
export function normalizeAvailability(
  input: string | null | undefined,
): Availability {
  if (!input) return 'UNKNOWN';

  const text = input.replace(/\s+/g, ' ').trim();
  if (!text) return 'UNKNOWN';

  // schema.org availability arrives as a URI, and its tokens collide badly
  // with the free-text rules below: "https://schema.org/InStock" contains
  // "InStock" but "https://schema.org/OutOfStock" ALSO contains "Stock", and
  // "LimitedAvailability" contains "Availability". Handling the enumerated
  // vocabulary explicitly, before any regex runs, removes that ambiguity.
  const schemaOrg = /schema\.org\/(\w+)/i.exec(text);
  if (schemaOrg?.[1]) {
    switch (schemaOrg[1].toLowerCase()) {
      case 'instock':
      case 'onlineonly':
      case 'instoreonly':
        return 'IN_STOCK';
      case 'limitedavailability':
        return 'LIMITED_STOCK';
      case 'outofstock':
      case 'soldout':
        return 'OUT_OF_STOCK';
      case 'preorder':
      case 'presale':
      case 'backorder':
        return 'PREORDER';
      case 'discontinued':
        return 'DISCONTINUED';
      default:
        return 'UNKNOWN';
    }
  }

  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.value;
  }

  return 'UNKNOWN';
}
