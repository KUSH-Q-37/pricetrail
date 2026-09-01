import { isYearEligible, calculatePriorityScore } from './lifecycle-manager';
import { ProductCategory } from '@pricetrail/database';
import { describe, it, expect } from 'vitest';

describe('Lifecycle Manager', () => {
  describe('isYearEligible', () => {
    it('Test A — Initial 2026', () => {
      const systemDate = new Date('2026-09-01T00:00:00.000Z');
      expect(isYearEligible(2026, systemDate)).toBe(true);
      expect(isYearEligible(2025, systemDate)).toBe(true);
      expect(isYearEligible(2024, systemDate)).toBe(false);
    });

    it('Test B — 2027 rollover', () => {
      const systemDate = new Date('2027-01-01T00:00:00.000Z');
      expect(isYearEligible(2027, systemDate)).toBe(true);
      expect(isYearEligible(2026, systemDate)).toBe(true);
      expect(isYearEligible(2025, systemDate)).toBe(false);
    });

    it('Test C — 2028 rollover', () => {
      const systemDate = new Date('2028-01-01T00:00:00.000Z');
      expect(isYearEligible(2028, systemDate)).toBe(true);
      expect(isYearEligible(2027, systemDate)).toBe(true);
      expect(isYearEligible(2026, systemDate)).toBe(false);
    });
  });

  describe('calculatePriorityScore', () => {
    it('prioritizes VM One relevant categories', () => {
      const tvScore = calculatePriorityScore(ProductCategory.TELEVISION, null, false);
      const otherScore = calculatePriorityScore(ProductCategory.OTHER, null, false);
      expect(tvScore).toBeGreaterThan(otherScore);
    });

    it('prioritizes YouTube featured products', () => {
      const featured = calculatePriorityScore(ProductCategory.OTHER, null, true);
      const unfeatured = calculatePriorityScore(ProductCategory.OTHER, null, false);
      expect(featured).toBeGreaterThan(unfeatured);
    });
  });
});
