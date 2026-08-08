import type { AttributeAnalysis } from './layers/attribute.layer';
import type { IdentifierAnalysis } from './layers/identifier.layer';
import type { MatchInput, VetoReason } from './types';

export interface VetoOutcome {
  vetoed: boolean;
  reason?: VetoReason;
  detail?: string;
}

/**
 * Words that mark a listing as an ACCESSORY FOR a device rather than the
 * device. Ordered by how unambiguous they are.
 *
 * This is the veto that pure similarity scoring cannot survive. "Apple iPhone
 * 15 Pro Silicone Case with MagSafe" and "Apple iPhone 15 Pro" share the brand,
 * the model, the category and nearly every token — cosine similarity is around
 * 0.95, and the identifier layer sees the same brand. Without this rule the
 * engine confidently pairs a ₹4,900 case with a ₹1,34,900 phone and then
 * records the case's price as the phone's forever.
 */
const ACCESSORY_MARKERS = [
  'back cover',
  'flip cover',
  'phone case',
  'screen guard',
  'screen protector',
  'tempered glass',
  'camera lens protector',
  'charging cable',
  'charger adapter',
  'power adapter',
  'carrying case',
  'protective case',
  'silicone case',
  'leather case',
  'skin sticker',
  'stand holder',
  'wall mount',
  'remote control',
];

/** Weaker markers: only meaningful with a "for <device>" construction. */
const WEAK_ACCESSORY_MARKERS = ['case', 'cover', 'guard', 'protector', 'mount', 'stand'];

/** Condition markers. A refurbished unit is a different product at a different price. */
const CONDITION_MARKERS = [
  'renewed',
  'refurbished',
  'pre-owned',
  'preowned',
  'used',
  'open box',
  'unboxed',
  'seller refurbished',
];

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

function isAccessory(title: string): boolean {
  const text = normalize(title);

  for (const marker of ACCESSORY_MARKERS) {
    if (text.includes(` ${marker} `)) return true;
  }

  // "Case for iPhone 15" / "Cover for Galaxy S24" — the "for" construction is
  // what distinguishes an accessory from a device that merely ships with one
  // ("iPhone 15 with case in the box" is still a phone).
  for (const marker of WEAK_ACCESSORY_MARKERS) {
    if (new RegExp(`\\b${marker}\\b[^.]{0,20}\\bfor\\b`).test(text)) return true;
    if (new RegExp(`\\bfor\\b[^.]{0,30}\\b${marker}\\b`).test(text)) return true;
  }

  return false;
}

function hasConditionMarker(title: string): boolean {
  const text = normalize(title);
  return CONDITION_MARKERS.some((marker) => text.includes(` ${marker} `));
}

/**
 * Hard vetoes, applied AFTER scoring and overriding it entirely.
 *
 * Separate from the weighted score on purpose. A veto answers "could these
 * possibly be the same product?", which is a different question from "how
 * similar are they?". No amount of similarity should be able to outvote a
 * confirmed capacity difference, and no weight tuning can express that —
 * a weight can always be outvoted by other weights.
 */
export function applyVetoes(
  a: MatchInput,
  b: MatchInput,
  identifier: IdentifierAnalysis,
  attribute: AttributeAnalysis,
): VetoOutcome {
  // Different categories cannot be the same product.
  if (a.category !== b.category && a.category !== 'OTHER' && b.category !== 'OTHER') {
    return {
      vetoed: true,
      reason: 'CATEGORY_MISMATCH',
      detail: `${a.category} vs ${b.category}`,
    };
  }

  if (identifier.brand === 'mismatch') {
    return {
      vetoed: true,
      reason: 'BRAND_MISMATCH',
      detail: `${a.brand ?? '?'} vs ${b.brand ?? '?'}`,
    };
  }

  // Two valid but different barcodes are conclusive.
  if (identifier.gtin === 'mismatch') {
    return {
      vetoed: true,
      reason: 'IDENTIFIER_CONFLICT',
      detail: `EAN/UPC ${a.ean ?? a.upc} vs ${b.ean ?? b.upc}`,
    };
  }

  // The capacity-variant case. See ACCESSORY_MARKERS above for why this
  // cannot be expressed as a weight.
  if (attribute.vetoViolations.length > 0) {
    const violation = attribute.vetoViolations[0]!;
    return {
      vetoed: true,
      reason: 'ATTRIBUTE_MISMATCH',
      detail: `${violation.key}: ${String(violation.left)} vs ${String(violation.right)}`,
    };
  }

  // Accessory on exactly one side. If BOTH are accessories they may genuinely
  // be the same case, so the marker is only decisive when it differs.
  const accessoryA = isAccessory(a.title);
  const accessoryB = isAccessory(b.title);
  if (accessoryA !== accessoryB) {
    return {
      vetoed: true,
      reason: 'ACCESSORY_VS_DEVICE',
      detail: accessoryA ? 'left is an accessory' : 'right is an accessory',
    };
  }

  const conditionA = hasConditionMarker(a.title);
  const conditionB = hasConditionMarker(b.title);
  if (conditionA !== conditionB) {
    return {
      vetoed: true,
      reason: 'CONDITION_MISMATCH',
      detail: conditionA ? 'left is renewed/used' : 'right is renewed/used',
    };
  }

  return { vetoed: false };
}

/**
 * Price sanity, evaluated separately from the vetoes above.
 *
 * A large price gap is SUSPICIOUS but not conclusive — genuine cross-platform
 * gaps happen during flash sales, and one side may be quoting an
 * out-of-stock or third-party price. So this downgrades to review rather than
 * rejecting, which keeps a real match recoverable by a human instead of
 * silently discarded.
 */
export function isPriceImplausible(a: MatchInput, b: MatchInput): boolean {
  if (!a.priceMinor || !b.priceMinor) return false;
  const [low, high] = a.priceMinor <= b.priceMinor
    ? [a.priceMinor, b.priceMinor]
    : [b.priceMinor, a.priceMinor];
  return high > low * 3;
}

export const __testing = { isAccessory, hasConditionMarker };
