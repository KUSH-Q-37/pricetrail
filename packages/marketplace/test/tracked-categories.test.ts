import { describe, expect, it } from 'vitest';

import {
  TRACKED_CATEGORY_SLUGS,
  classifyForTracking,
  normalizeCategorySlug,
} from '../src/shared/tracked-categories';

/**
 * Scope is enforced from Flipkart's own category slug. Every value asserted
 * here was MEASURED against live Flipkart, not invented — see the probe
 * results in the module's comment.
 */
describe('normalizeCategorySlug', () => {
  it('strips the _new suffix Flipkart versions categories with', () => {
    // refrigerator_new, washing_machine_new, air_conditioner_new,
    // microwave_new and dishwasher_new were all observed live. Without this,
    // the next such rename silently drops a category out of scope.
    expect(normalizeCategorySlug('refrigerator_new')).toBe('refrigerator');
    expect(normalizeCategorySlug('air_conditioner_new')).toBe('air_conditioner');
    expect(normalizeCategorySlug('  MOBILE  ')).toBe('mobile');
  });

  it('leaves a slug that merely contains "new" alone', () => {
    expect(normalizeCategorySlug('news_stand')).toBe('news_stand');
  });
});

describe('classifyForTracking', () => {
  it.each([
    ['mobile', 'smartphones'],
    ['television', 'TVs'],
    ['air_conditioner_new', 'air conditioners, unnormalized'],
    ['refrigerator_new', 'refrigerators, unnormalized'],
    ['washing_machine_new', 'washing machines, unnormalized'],
    ['vacuum_cleaner', 'vacuums'],
    ['computer', 'laptops'],
    ['headphone', 'audio'],
    ['smart_lighting', 'smart home'],
    ['home_security_camera', 'smart home security'],
  ])('tracks %s (%s)', (slug) => {
    const decision = classifyForTracking(slug);
    expect(decision.action).toBe('track');
    expect(decision.reason).toBe('allowed');
  });

  it.each([
    ['shoe', 'footwear'],
    ['sport_mat', 'fitness'],
    ['diary_notebook', 'stationery'],
    ['musical_toy', 'toys'],
    ['backpack', 'ambiguous: laptop bags and fashion share this slug'],
  ])('untracks %s (%s)', (slug) => {
    const decision = classifyForTracking(slug);
    expect(decision.action).toBe('untrack');
    expect(decision.reason).toBe('not-in-scope');
  });

  it('distinguishes an unknown category from a known exclusion', () => {
    // The distinction is the whole point of reporting a reason: one means the
    // allowlist needs extending, the other means it worked. Collapsing them
    // would make a gap in the list indistinguishable from correct behaviour.
    expect(classifyForTracking('quantum_flux_capacitor').reason).toBe('unknown-category');
    expect(classifyForTracking('shoe').reason).toBe('not-in-scope');
  });

  it('leaves tracking alone when no category is stated', () => {
    // NOT 'untrack'. Amazon cannot be scraped and so never states a category;
    // treating silence as grounds to untrack would stand down every Amazon
    // listing the moment Creators API credentials arrived, permanently and
    // invisibly. This exact case was caught by the pipeline suite, where a
    // fixture without a category had its tracking silently revoked.
    expect(classifyForTracking(undefined).action).toBe('leave');
    expect(classifyForTracking(undefined).reason).toBe('no-category-stated');
    expect(classifyForTracking('   ').action).toBe('leave');
  });

  it('untracks an unknown category but never an absent one', () => {
    // The difference that matters: a category we have not catalogued is a real
    // signal and acts; no category at all is not.
    expect(classifyForTracking('quantum_flux').action).toBe('untrack');
    expect(classifyForTracking(undefined).action).toBe('leave');
  });

  it('covers every category the discovery seeds actually return', () => {
    // Guards the seeds and the allowlist against drifting apart: a seed whose
    // category is not tracked would enrol products the very next sweep then
    // untracks, burning budget to no end.
    for (const slug of ['mobile', 'computer', 'tablet', 'television', 'monitor',
      'printer', 'gamingconsole', 'headphone', 'speaker', 'power_bank', 'smartwatch',
      'mouse', 'keyboard', 'pendrive', 'memory_card', 'router', 'battery_charger',
      'vacuum_cleaner', 'air_cooler', 'induction_cook_top', 'chimney', 'air_fryer',
      'water_purifier', 'mixer_grinder_juicer', 'fan', 'water_geyser',
      'smart_switch', 'smart_door_lock', 'video_door_phone', 'sports_action_camera']) {
      expect(TRACKED_CATEGORY_SLUGS.has(slug), `${slug} should be tracked`).toBe(true);
    }
  });
});

describe('classifyForTracking on Amazon', () => {
  // Amazon uses an entirely unrelated vocabulary for the same idea: Flipkart
  // says `computer`, Amazon says `Personal Computer`. Running both through one
  // list would untrack half of whichever platform the list was not built from.
  it('untracks the product groups that are clearly out of scope', () => {
    for (const group of ['Shoes', 'Apparel', 'Book', 'Toy', 'Grocery', 'Watch']) {
      const decision = classifyForTracking(group, 'AMAZON');
      expect(decision.action, `${group} should untrack`).toBe('untrack');
      expect(decision.reason).toBe('not-in-scope');
    }
  });

  it('leaves an unrecognised Amazon group alone rather than untracking it', () => {
    // The asymmetry with Flipkart is deliberate. Flipkart's vocabulary was
    // measured live; Amazon's cannot be until credentials exist, so an
    // allowlist here would untrack every legitimate product whose group name
    // was guessed wrong — a laptop under "Personal Computer" would silently
    // vanish and look like a broken Amazon integration.
    expect(classifyForTracking('Personal Computer', 'AMAZON').action).toBe('leave');
    expect(classifyForTracking('CE', 'AMAZON').action).toBe('leave');
  });

  it('is case-insensitive about product groups', () => {
    expect(classifyForTracking('SHOES', 'AMAZON').action).toBe('untrack');
    expect(classifyForTracking('  shoes  ', 'AMAZON').action).toBe('untrack');
  });

  it('does not apply the Flipkart allowlist to Amazon, or vice versa', () => {
    // `mobile` is a Flipkart slug. Amazon never emits it, and if it somehow
    // did, it must not be silently accepted through the wrong platform's list.
    expect(classifyForTracking('mobile', 'FLIPKART').action).toBe('track');
    expect(classifyForTracking('mobile', 'AMAZON').action).toBe('leave');

    // `Shoes` is Amazon's spelling; Flipkart's is `shoe`. Each untracks under
    // its own platform, and neither is required to know the other's.
    expect(classifyForTracking('Shoes', 'AMAZON').action).toBe('untrack');
    expect(classifyForTracking('shoe', 'FLIPKART').action).toBe('untrack');
  });

  it('still leaves a product that states nothing', () => {
    // Every Amazon listing today, since Amazon cannot be scraped.
    expect(classifyForTracking(undefined, 'AMAZON').action).toBe('leave');
  });
});
