/**
 * Which product categories this project collects prices for.
 *
 * Scope: electronics, electronic accessories, home appliances, smart home.
 * Everything else — fashion, footwear, sports, stationery, toys, books,
 * groceries — is out, whether it arrives through catalogue discovery or
 * because somebody pasted its URL.
 *
 * WHY THE MARKETPLACE'S OWN SLUG, NOT KEYWORDS
 * --------------------------------------------
 * Flipkart states a category on every product page, inside the same JSON-LD
 * Product node the parser already reads: "mobile", "vacuum_cleaner",
 * "refrigerator_new", "shoe". Using it is one field lookup.
 *
 * The alternative — inferring from the title — fails on precisely the products
 * that matter. "boAt Airdopes 141" is a pair of earbuds and contains no
 * category word; "Mi Smart Band" is not a phone despite the brand; a keyword
 * classifier would need to know every brand's product naming, and would still
 * be wrong often enough to untrack real products or admit sandals.
 *
 * Every slug below was MEASURED against live Flipkart rather than guessed, by
 * searching each seed category and reading the category off the first two
 * results. Both samples agreed in all 39 cases, so the signal is stable.
 */

/**
 * Flipkart versions some categories with a `_new` suffix — refrigerator_new,
 * washing_machine_new, air_conditioner_new, microwave_new, dishwasher_new were
 * all observed. Stripping it means the next such rename does not silently drop
 * a whole category out of scope.
 */
export function normalizeCategorySlug(slug: string): string {
  // Lowercased and _new-stripped. Amazon's groups are multi-word with spaces
  // ("Personal Computer"); Flipkart's are underscored slugs. Both are compared
  // as-is beyond case, because inventing a shared shape for two unrelated
  // vocabularies would only make each match the other's entries by accident.
  return slug.trim().toLowerCase().replace(/_new$/, '');
}

/**
 * The allowlist, in the marketplace's own vocabulary.
 *
 * Deliberately an allowlist, not a denylist. A denylist admits every category
 * nobody thought to exclude, which for a marketplace with thousands of them
 * means the default is wrong. Here the default is "not tracked", and an
 * unrecognised category is logged with its slug so this list can be extended
 * from evidence.
 */
export const TRACKED_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
  // --- electronics ---------------------------------------------------------
  'mobile',
  'computer',
  'tablet',
  'television',
  'monitor',
  'printer',
  'gamingconsole',
  'camera',
  'sports_action_camera',
  'dslr',

  // --- electronic accessories ----------------------------------------------
  'headphone',
  'speaker',
  'power_bank',
  'smartwatch',
  'mouse',
  'keyboard',
  'pendrive',
  'memory_card',
  'router',
  'battery_charger',

  // --- home appliances ------------------------------------------------------
  'refrigerator',
  'washing_machine',
  'air_conditioner',
  'microwave',
  'dishwasher',
  'water_purifier',
  'mixer_grinder_juicer',
  'fan',
  'water_geyser',
  'vacuum_cleaner',
  'air_cooler',
  'induction_cook_top',
  'chimney',
  'air_fryer',

  // --- smart home -----------------------------------------------------------
  'smart_lighting',
  'smart_switch',
  'home_security_camera',
  'video_door_phone',
  'smart_door_lock',
]);

/**
 * Deliberately NOT tracked, though they turned up while measuring:
 *
 *   shoe, sport_mat, diary_notebook, musical_toy   — out of scope outright
 *   backpack                                       — ambiguous
 *
 * `backpack` is the interesting one. Searching "laptop bag" returns products
 * Flipkart files under `backpack`, alongside school and hiking bags. Allowing
 * it to admit laptop bags would admit fashion backpacks with it, and there is
 * no way to separate them from this field alone. Excluded, and "laptop bag" is
 * correspondingly not a discovery seed.
 */

export interface CategoryDecision {
  /**
   * What to do about tracking.
   *
   *   'track'   — the marketplace stated a category and it is in scope
   *   'untrack' — the marketplace stated a category and it is not
   *   'leave'   — nothing usable was stated; not enough to act on
   *
   * Three outcomes rather than a boolean, because "not in scope" and "we do
   * not know" must not collapse into the same action. Treating silence as
   * grounds to untrack would stand down every listing whose page happens not
   * to say — which for Amazon is all of them. Absence of evidence is not
   * evidence.
   */
  action: 'track' | 'untrack' | 'leave';
  /** Normalized category, or undefined when nothing was stated. */
  slug?: string;
  reason: 'allowed' | 'not-in-scope' | 'unknown-category' | 'no-category-stated';
}

/** Known-excluded on Flipkart, as opposed to merely absent from the allowlist. */
const FLIPKART_EXCLUDED: ReadonlySet<string> = new Set([
  'shoe',
  'sport_mat',
  'diary_notebook',
  'musical_toy',
  'backpack',
]);

/**
 * Amazon's ProductGroup values for things this project does not track.
 *
 * A DENYLIST, where Flipkart gets an allowlist, and the asymmetry is
 * deliberate rather than sloppy.
 *
 * Flipkart's vocabulary was measured: 39 categories searched live, both
 * samples agreeing every time. Amazon's cannot be, because there are no
 * Creators API credentials in this project and the account cannot obtain them
 * until it has qualifying sales. These values come from the documented
 * ProductGroup vocabulary, NOT from observation.
 *
 * That difference decides the shape. An allowlist built on an unverified
 * vocabulary would untrack every legitimate product whose group name we
 * guessed wrong — a laptop filed under "Personal Computer" rather than
 * "computer" would silently vanish, and the symptom would look like a broken
 * Amazon integration. A denylist fails the other way: something out of scope
 * slips through until its group is added. That is the survivable error.
 *
 * WHEN CREDENTIALS ARRIVE: run one pass over a handful of known ASINs across
 * these categories, read the real productGroup values, and convert this to an
 * allowlist the way Flipkart's was built. Until then it is a best effort that
 * catches the obvious cases and admits it.
 */
const AMAZON_EXCLUDED: ReadonlySet<string> = new Set([
  'shoes',
  'apparel',
  'book',
  'books',
  'ebooks',
  'toy',
  'toys',
  'grocery',
  'sports',
  'health and beauty',
  'beauty',
  'baby product',
  'pet products',
  'jewelry',
  'watch',
  'luggage',
  'shoes and accessories',
  'lawn & patio',
  'music',
  'dvd',
  'video games',
  'automotive',
  'furniture',
  'art and craft supply',
  'office product',
]);

/**
 * Decide whether a product belongs in the tracked catalogue.
 *
 * Platform-aware because the two marketplaces use entirely unrelated
 * vocabularies for the same idea. Flipkart says `computer`; Amazon says
 * `Personal Computer`. Running both through one list would untrack half of
 * whichever platform the list was not built from.
 */
export function classifyForTracking(
  rawCategory: string | undefined,
  platform: 'AMAZON' | 'FLIPKART' = 'FLIPKART',
): CategoryDecision {
  if (!rawCategory || rawCategory.trim().length === 0) {
    return { action: 'leave', reason: 'no-category-stated' };
  }

  const slug = normalizeCategorySlug(rawCategory);

  if (platform === 'AMAZON') {
    // Denylist: exclude what is known, leave the rest alone. See the note on
    // AMAZON_EXCLUDED for why this is not an allowlist.
    return AMAZON_EXCLUDED.has(slug)
      ? { action: 'untrack', slug, reason: 'not-in-scope' }
      : { action: 'leave', slug, reason: 'allowed' };
  }

  if (TRACKED_CATEGORY_SLUGS.has(slug)) {
    return { action: 'track', slug, reason: 'allowed' };
  }

  // Known-excluded and never-seen both untrack, but are reported differently
  // on purpose: the first is a decision working as intended, the second is a
  // gap in the allowlist. Only the second is a reason to come back and edit
  // it, and without the distinction the two are indistinguishable in the logs.
  return {
    action: 'untrack',
    slug,
    reason: FLIPKART_EXCLUDED.has(slug) ? 'not-in-scope' : 'unknown-category',
  };
}
