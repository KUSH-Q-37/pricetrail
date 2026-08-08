import { describe, expect, it } from 'vitest';

import { compareBrands, normalizeBrand } from '../src/normalizers/brand';
import {
  compareGtins,
  compareModels,
  gtinCheckDigit,
  isValidGtin,
  normalizeModel,
  toGtin14,
} from '../src/normalizers/identifier';

describe('brand normalisation', () => {
  it('folds case and strips corporate suffixes', () => {
    expect(normalizeBrand('APPLE')).toBe('apple');
    expect(normalizeBrand('Samsung Electronics')).toBe('samsung');
    expect(normalizeBrand('LG India')).toBe('lg');
    expect(normalizeBrand('Blue Star')).toBe('bluestar');
  });

  it('passes unknown brands through unchanged', () => {
    expect(normalizeBrand('Acme Widgets')).toBe('acmewidgets');
  });

  it('returns undefined for absent input', () => {
    expect(normalizeBrand('')).toBeUndefined();
    expect(normalizeBrand(undefined)).toBeUndefined();
  });

  it('treats sub-brands as the same family', () => {
    // Xiaomi/Redmi/Poco are one manufacturer. Treating them as different
    // brands would fire the brand veto on genuine cross-platform pairs.
    expect(compareBrands('Redmi', 'Xiaomi')).toBe('match');
    expect(compareBrands('POCO', 'Xiaomi')).toBe('match');
  });

  it('never reads missing data as a mismatch', () => {
    // A brand veto on absent data would reject every listing that simply
    // omits the field — absence of evidence is not evidence of difference.
    expect(compareBrands(undefined, 'Apple')).toBe('unknown');
    expect(compareBrands(undefined, undefined)).toBe('unknown');
  });

  it('detects genuinely different brands', () => {
    expect(compareBrands('Realme', 'OPPO')).toBe('mismatch');
  });
});

describe('GTIN / EAN / UPC', () => {
  it('computes the GS1 mod-10 check digit', () => {
    expect(gtinCheckDigit('019594902202')).toBe(9);
  });

  it('accepts a valid EAN-13 and rejects a corrupted one', () => {
    expect(isValidGtin('0195949022029')).toBe(true);
    expect(isValidGtin('0195949022028')).toBe(false);
  });

  it('rejects values that are not barcodes at all', () => {
    // Scraped identifier fields often contain a truncated model number or an
    // ASIN. Admitting those lets two unrelated products "match" on garbage.
    expect(isValidGtin('1234567890123')).toBe(false);
    expect(isValidGtin('B0CHX1W1XY')).toBe(false);
  });

  it('widens UPC-12 and EAN-13 to a common GTIN-14', () => {
    // Amazon commonly reports a UPC where Flipkart reports an EAN for the
    // SAME product. Comparing raw strings finds no match on a provably
    // identical pair.
    expect(toGtin14('027242923072')).toBe('00027242923072');
    expect(toGtin14('0027242923072')).toBe('00027242923072');
    expect(compareGtins('027242923072', '0027242923072')).toBe('match');
  });

  it('treats two valid, different barcodes as conclusive', () => {
    expect(compareGtins('8806095299174', '8806095299181')).toBe('mismatch');
  });

  it('reports unknown when either side is unparseable', () => {
    expect(compareGtins('not-a-barcode', '0195949022029')).toBe('unknown');
  });
});

describe('model numbers', () => {
  it('ignores separator differences', () => {
    expect(normalizeModel('GL-S292RPZX')).toBe('GLS292RPZX');
    expect(normalizeModel('GL S292RPZX')).toBe('GLS292RPZX');
    expect(compareModels('GL-S292RPZX', 'GLS292RPZX')).toBe('match');
  });

  it('rejects tokens too short to identify anything', () => {
    expect(normalizeModel('A1')).toBeUndefined();
    // A bare 4-digit number is a year or a capacity, not a model.
    expect(normalizeModel('2024')).toBeUndefined();
  });

  it('tolerates a regional suffix on one side', () => {
    expect(compareModels('SM-S928B', 'SM-S928B/DS')).toBe('match');
  });

  it('distinguishes genuinely different models', () => {
    expect(compareModels('SM-S928B', 'SM-S921B')).toBe('mismatch');
  });
});
