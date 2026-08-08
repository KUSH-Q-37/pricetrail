import type { ProductCategory } from '../types';

export interface AttributeDefinition {
  key: string;
  /**
   * When true, a CONFIRMED mismatch rejects the pair outright rather than
   * lowering its score.
   *
   * This flag is the single most important piece of configuration in the
   * engine. A 128 GB and a 256 GB iPhone 15 Pro share brand, model number,
   * embedding space and roughly 95% of their title — a purely weighted score
   * rates them ~0.93 and auto-confirms. Only a veto catches it.
   */
  veto: boolean;
  /** Contribution to the attribute layer when both sides supply a value. */
  weight: number;
  /**
   * Absolute tolerance for numeric equality. Guards against rounding
   * differences between marketplaces (6.06" vs 6.1"), NOT against genuinely
   * different variants.
   */
  tolerance?: number;
}

export interface CategorySchema {
  category: ProductCategory;
  attributes: AttributeDefinition[];
}

/**
 * Per-category attribute definitions.
 *
 * These live in code rather than the database on purpose: they are versioned
 * with the matching logic they drive, reviewed in the same pull request, and
 * unit-testable without a database. The database stores extracted attribute
 * VALUES; this file defines what those values mean.
 *
 * Scope is electronics + appliances (the Phase 1 decision).
 *
 * Note what is deliberately NOT veto-eligible: colour. Marketplaces name the
 * same colour differently — "Natural Titanium" vs "Titanium Natural" vs
 * "Natural" — and vetoing on that would discard a large share of genuine
 * matches. It contributes to the score and nothing more.
 */
const SCHEMAS: Record<ProductCategory, AttributeDefinition[]> = {
  PHONE: [
    // Capacity variants are the classic false-positive. Both veto.
    { key: 'storage_gb', veto: true, weight: 0.35 },
    { key: 'ram_gb', veto: true, weight: 0.3 },
    { key: 'colour', veto: false, weight: 0.2 },
    { key: 'screen_in', veto: false, weight: 0.15, tolerance: 0.15 },
  ],

  TABLET: [
    { key: 'storage_gb', veto: true, weight: 0.35 },
    { key: 'ram_gb', veto: true, weight: 0.25 },
    { key: 'screen_in', veto: true, weight: 0.25, tolerance: 0.2 },
    { key: 'colour', veto: false, weight: 0.15 },
  ],

  LAPTOP: [
    { key: 'ram_gb', veto: true, weight: 0.3 },
    { key: 'storage_gb', veto: true, weight: 0.3 },
    // Screen size defines the SKU on laptops (13" vs 15" are different
    // products), so unlike phones it vetoes.
    { key: 'screen_in', veto: true, weight: 0.25, tolerance: 0.2 },
    { key: 'colour', veto: false, weight: 0.15 },
  ],

  AUDIO: [
    { key: 'colour', veto: false, weight: 0.5 },
    { key: 'form_factor', veto: false, weight: 0.5 },
  ],

  TELEVISION: [
    { key: 'screen_in', veto: true, weight: 0.45, tolerance: 0.5 },
    { key: 'resolution', veto: true, weight: 0.35 },
    { key: 'colour', veto: false, weight: 0.2 },
  ],

  REFRIGERATOR: [
    // 260 L and 265 L are different SKUs at different prices.
    { key: 'capacity_l', veto: true, weight: 0.45, tolerance: 1 },
    { key: 'star_rating', veto: true, weight: 0.35 },
    { key: 'colour', veto: false, weight: 0.2 },
  ],

  WASHING_MACHINE: [
    { key: 'capacity_kg', veto: true, weight: 0.45, tolerance: 0.05 },
    { key: 'star_rating', veto: true, weight: 0.35 },
    { key: 'colour', veto: false, weight: 0.2 },
  ],

  AIR_CONDITIONER: [
    { key: 'capacity_ton', veto: true, weight: 0.45, tolerance: 0.01 },
    { key: 'star_rating', veto: true, weight: 0.35 },
    { key: 'colour', veto: false, weight: 0.2 },
  ],

  /**
   * Unknown category. No attribute vetoes are available, so the pipeline caps
   * confidence below auto-confirm — an uncategorised product cannot be
   * confidently matched on attributes we have no rules for.
   */
  OTHER: [{ key: 'colour', veto: false, weight: 1 }],
};

export function getCategorySchema(category: ProductCategory): CategorySchema {
  return { category, attributes: SCHEMAS[category] ?? SCHEMAS.OTHER };
}

/** Attribute keys whose mismatch rejects a pair, for this category. */
export function getVetoKeys(category: ProductCategory): string[] {
  return getCategorySchema(category)
    .attributes.filter((attribute) => attribute.veto)
    .map((attribute) => attribute.key);
}

export const ALL_CATEGORIES = Object.keys(SCHEMAS) as ProductCategory[];
