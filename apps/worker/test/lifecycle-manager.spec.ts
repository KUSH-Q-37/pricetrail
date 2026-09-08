import { calculatePriorityScore, isEligibleForTracking } from '../src/jobs/lifecycle-manager';
import { ProductCategory, ProductStatus } from '@pricetrail/database';
// @ts-ignore
import { describe, it, expect } from 'vitest';

describe('Lifecycle Manager', () => {

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
