import { describe, expect, it } from 'vitest';

import { matchProducts } from '../src/pipeline';
import { getVetoKeys } from '../src/schemas/category-schema';
import { __testing } from '../src/vetoes';
import { GOLDEN_SET } from './golden-set';

describe('category schemas', () => {
  it('vetoes capacity variants per category', () => {
    expect(getVetoKeys('PHONE')).toEqual(['storage_gb', 'ram_gb']);
    expect(getVetoKeys('REFRIGERATOR')).toEqual(['capacity_l', 'star_rating']);
  });

  it('vetoes screen size on laptops but not phones', () => {
    // 13" vs 15" is a different laptop SKU; on a phone it is a spec detail.
    // This asymmetry is why the schemas are category-dispatched.
    expect(getVetoKeys('LAPTOP')).toContain('screen_in');
    expect(getVetoKeys('PHONE')).not.toContain('screen_in');
  });

  it('never vetoes colour', () => {
    // Marketplaces name the same finish differently; vetoing here would
    // discard a large share of genuine matches.
    expect(getVetoKeys('PHONE')).not.toContain('colour');
  });

  it('has no attribute vetoes for an uncategorised product', () => {
    expect(getVetoKeys('OTHER')).toEqual([]);
  });
});

describe('accessory and condition detection', () => {
  it.each([
    'Apple Silicone Case with MagSafe for iPhone 15 Pro',
    'Tempered Glass Screen Guard for Galaxy S24',
    'Spigen Back Cover for OnePlus 12R',
  ])('flags %s as an accessory', (title) => {
    expect(__testing.isAccessory(title)).toBe(true);
  });

  it.each([
    'Apple iPhone 15 Pro (256 GB) Natural Titanium',
    'Sony WH-1000XM5 Wireless Headphones',
  ])('does not flag the device itself: %s', (title) => {
    expect(__testing.isAccessory(title)).toBe(false);
  });

  it.each(['(Renewed) Apple iPhone 15 Pro', 'Refurbished Samsung Galaxy S23'])(
    'detects the condition marker in %s',
    (title) => {
      expect(__testing.hasConditionMarker(title)).toBe(true);
    },
  );

  it('leaves a new product unmarked', () => {
    expect(__testing.hasConditionMarker('Apple iPhone 15 Pro 256 GB')).toBe(false);
  });
});

/**
 * The golden set, run as a classifier.
 *
 * Weighted towards NEAR-MISSES on purpose. Telling an iPhone from a fridge is
 * trivial and proves nothing; every expensive failure in a price tracker is a
 * pair that looks almost identical and is not.
 */
describe('golden set', () => {
  it.each(GOLDEN_SET.map((testCase) => [testCase.name, testCase] as const))(
    '%s',
    (_name, testCase) => {
      const result = matchProducts(testCase.a, testCase.b);

      if (testCase.expectDecision) {
        expect(result.decision).toBe(testCase.expectDecision);
      }
      if (testCase.expectVeto) {
        expect(result.vetoReason).toBe(testCase.expectVeto);
      }

      // A pair is "linked" only when the engine would tie their prices
      // together without a human. NEEDS_REVIEW is not linked.
      const linked = result.decision === 'AUTO_CONFIRMED';
      if (!testCase.sameProduct) {
        expect(linked, `false positive on "${testCase.name}"`).toBe(false);
      } else {
        expect(result.decision, `missed match on "${testCase.name}"`).not.toBe('REJECTED');
      }
    },
  );

  it('has ZERO false positives across the whole set', () => {
    // The gate. There is no acceptable rate for silently merging two
    // different products' price histories — a false negative just means
    // "not matched yet", a false positive is permanent corruption.
    const falsePositives = GOLDEN_SET.filter(
      (testCase) =>
        !testCase.sameProduct &&
        matchProducts(testCase.a, testCase.b).decision === 'AUTO_CONFIRMED',
    );

    expect(falsePositives.map((testCase) => testCase.name)).toEqual([]);
  });

  it('achieves >= 95% precision', () => {
    let truePositives = 0;
    let falsePositives = 0;

    for (const testCase of GOLDEN_SET) {
      const linked = matchProducts(testCase.a, testCase.b).decision === 'AUTO_CONFIRMED';
      if (linked && testCase.sameProduct) truePositives++;
      if (linked && !testCase.sameProduct) falsePositives++;
    }

    const linkedTotal = truePositives + falsePositives;
    const precision = linkedTotal === 0 ? 1 : truePositives / linkedTotal;
    expect(precision).toBeGreaterThanOrEqual(0.95);
  });
});

describe('scoring behaviour', () => {
  const identicalWithBarcode = GOLDEN_SET[0]!;
  const noBarcode = GOLDEN_SET.find(
    (testCase) => testCase.name === 'same product, colour named differently',
  )!;

  it('zeroes confidence on a vetoed pair', () => {
    // Retaining a high score would let someone sort the review queue by
    // confidence and "rescue" a pair the engine already rejected.
    const phoneVsCase = GOLDEN_SET.find((c) => c.name === 'PHONE vs ITS OWN CASE')!;
    const result = matchProducts(phoneVsCase.a, phoneVsCase.b);

    expect(result.confidence).toBe(0);
    expect(result.vetoReason).toBe('ACCESSORY_VS_DEVICE');
  });

  it('auto-confirms a confirmed barcode even without embeddings', () => {
    // A GTIN is manufacturer-assigned, globally unique and check-digit
    // protected. Holding it back for lack of an embedding would route every
    // correctly-identified product to a human queue.
    expect(matchProducts(identicalWithBarcode.a, identicalWithBarcode.b).decision).toBe(
      'AUTO_CONFIRMED',
    );
  });

  it('keeps the lexical fallback below the auto-confirm threshold', () => {
    const lexical = matchProducts(noBarcode.a, noBarcode.b);
    const embedded = matchProducts(noBarcode.a, noBarcode.b, { semanticSimilarity: 0.97 });

    expect(lexical.decision).toBe('NEEDS_REVIEW');
    expect(embedded.confidence).toBeGreaterThan(lexical.confidence);
  });

  it('refuses to auto-confirm with no identifiers, even at cosine 0.99', () => {
    // This is the cap that stops a phone being paired with its own case on
    // title similarity alone.
    const noIds = GOLDEN_SET.find((c) => c.name.includes('NO identifiers'))!;
    const result = matchProducts(noIds.a, noIds.b, { semanticSimilarity: 0.99 });

    expect(result.decision).toBe('NEEDS_REVIEW');
    expect(result.capReason).toBeTypeOf('string');
  });

  it('records the pipeline version alongside the score', () => {
    // Stored confidences are only comparable within a pipeline version.
    const result = matchProducts(identicalWithBarcode.a, identicalWithBarcode.b);
    expect(result.pipelineVersion).toBe('match-1.0.0');
    expect(result.explanation.length).toBeGreaterThan(0);
  });
});
