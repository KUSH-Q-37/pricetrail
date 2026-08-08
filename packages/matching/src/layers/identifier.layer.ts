import { compareBrands } from '../normalizers/brand';
import { compareGtins, compareModels } from '../normalizers/identifier';
import type { LayerResult, MatchInput } from '../types';

export interface IdentifierAnalysis extends LayerResult {
  gtin: 'match' | 'mismatch' | 'unknown';
  model: 'match' | 'mismatch' | 'unknown';
  brand: 'match' | 'mismatch' | 'unknown';
}

/**
 * Layer 1 — identifier matching. Weight 0.40, the highest of the three.
 *
 * A shared GTIN is the strongest evidence available anywhere in the pipeline:
 * it is assigned by the manufacturer, globally unique, and check-digit
 * protected. Two listings with the same valid GTIN are the same physical
 * product, full stop.
 *
 * This layer became substantially more reliable with the Phase 1 decision to
 * go API-first: PA-API returns Brand, Model, PartNumber, EAN and UPC as
 * STRUCTURED fields, so on the API path these are read rather than guessed
 * out of a spec table.
 */
export function analyzeIdentifiers(a: MatchInput, b: MatchInput): IdentifierAnalysis {
  const evidence: string[] = [];

  // EAN vs UPC is a real cross-marketplace case: they are the same numbering
  // space at different widths, so all four combinations are compared.
  const gtin = firstDecisive([
    compareGtins(a.ean, b.ean),
    compareGtins(a.upc, b.upc),
    compareGtins(a.ean, b.upc),
    compareGtins(a.upc, b.ean),
  ]);

  const model = firstDecisive([
    compareModels(a.modelNumber, b.modelNumber),
    compareModels(a.mpn, b.mpn),
    compareModels(a.modelNumber, b.mpn),
    compareModels(a.mpn, b.modelNumber),
  ]);

  const brand = compareBrands(a.brand, b.brand);

  if (gtin === 'match') evidence.push('GTIN/EAN identical');
  if (gtin === 'mismatch') evidence.push('GTIN/EAN differ');
  if (model === 'match') evidence.push('model number identical');
  if (model === 'mismatch') evidence.push('model numbers differ');
  if (brand === 'match') evidence.push('brand identical');
  if (brand === 'mismatch') evidence.push('brands differ');

  const applicable = gtin !== 'unknown' || model !== 'unknown' || brand !== 'unknown';

  if (!applicable) {
    evidence.push('no identifiers available on either side');
    return { score: 0, applicable: false, evidence, gtin, model, brand };
  }

  // A matching GTIN alone is conclusive. Nothing else in this layer can add
  // to it, and nothing short of a veto should subtract.
  if (gtin === 'match') {
    return { score: 1, applicable: true, evidence, gtin, model, brand };
  }

  // Conflicting GTINs are conclusive in the other direction: two valid,
  // different barcodes mean two different products, whatever the titles say.
  if (gtin === 'mismatch') {
    return { score: 0, applicable: true, evidence, gtin, model, brand };
  }

  let score = 0;
  if (model === 'match') score += 0.75;
  else if (model === 'mismatch') score -= 0.5;

  if (brand === 'match') score += 0.25;
  else if (brand === 'mismatch') score -= 0.5;

  return {
    score: clamp(score),
    applicable: true,
    evidence,
    gtin,
    model,
    brand,
  };
}

/** First non-'unknown' result, preferring a decisive answer over silence. */
function firstDecisive(
  results: Array<'match' | 'mismatch' | 'unknown'>,
): 'match' | 'mismatch' | 'unknown' {
  if (results.includes('match')) return 'match';
  if (results.includes('mismatch')) return 'mismatch';
  return 'unknown';
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
