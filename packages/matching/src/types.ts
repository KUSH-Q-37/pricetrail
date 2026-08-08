export type ProductCategory =
  | 'PHONE'
  | 'LAPTOP'
  | 'TABLET'
  | 'AUDIO'
  | 'TELEVISION'
  | 'REFRIGERATOR'
  | 'WASHING_MACHINE'
  | 'AIR_CONDITIONER'
  | 'OTHER';

export type Platform = 'AMAZON' | 'FLIPKART';

/** Everything the engine is allowed to see about one side of a pair. */
export interface MatchInput {
  platform: Platform;
  externalId: string;
  title: string;
  brand?: string;
  modelNumber?: string;
  mpn?: string;
  ean?: string;
  upc?: string;
  category: ProductCategory;
  /** Normalized values from packages/marketplace's attribute extractor. */
  attributes: Record<string, string | number | undefined>;
  priceMinor?: number;
}

export type MatchDecision =
  | 'AUTO_CONFIRMED'
  | 'NEEDS_REVIEW'
  | 'REJECTED';

export type VetoReason =
  | 'BRAND_MISMATCH'
  | 'IDENTIFIER_CONFLICT'
  | 'ATTRIBUTE_MISMATCH'
  | 'ACCESSORY_VS_DEVICE'
  | 'CONDITION_MISMATCH'
  | 'CATEGORY_MISMATCH';

/**
 * One layer's contribution.
 *
 * `applicable` is the field that makes this design work. A layer that returns
 * score 0 because the DATA IS MISSING is telling you something completely
 * different from a layer that returns 0 because the values CONFLICT — the
 * first is absence of evidence, the second is evidence of absence. Collapsing
 * them into one number is how a matcher ends up either rejecting every product
 * that lacks a barcode, or confidently pairing two products it knows nothing
 * about.
 */
export interface LayerResult {
  score: number;
  applicable: boolean;
  /** Human-readable trace, surfaced in the admin review queue. */
  evidence: string[];
}

export interface MatchResult {
  decision: MatchDecision;
  /** Blended 0..1, after veto and cap adjustments. */
  confidence: number;
  identifier: LayerResult;
  attribute: LayerResult;
  semantic: LayerResult;
  /** Set when a hard veto overrode the score. */
  vetoReason?: VetoReason;
  /** Why the confidence was capped below the auto-confirm threshold. */
  capReason?: string;
  explanation: string[];
  pipelineVersion: string;
}

export const PIPELINE_VERSION = 'match-1.0.0';

/**
 * Layer weights. Sum to 1.0 when every layer is applicable.
 * Changing these invalidates comparisons against stored confidences, which is
 * why product_matches records pipelineVersion alongside the score.
 */
export const WEIGHTS = {
  identifier: 0.4,
  attribute: 0.3,
  semantic: 0.3,
} as const;

export const THRESHOLDS = {
  autoConfirm: 0.85,
  review: 0.6,
} as const;
