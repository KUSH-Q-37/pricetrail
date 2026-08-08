import { analyzeAttributes } from './layers/attribute.layer';
import { analyzeIdentifiers } from './layers/identifier.layer';
import { lexicalSimilarity } from './layers/semantic.layer';
import {
  PIPELINE_VERSION,
  THRESHOLDS,
  WEIGHTS,
  type LayerResult,
  type MatchInput,
  type MatchResult,
} from './types';
import { applyVetoes, isPriceImplausible } from './vetoes';

export interface MatchOptions {
  /**
   * Cosine similarity from pgvector (Phase 10). When absent the pipeline
   * falls back to a lexical proxy and caps confidence accordingly — a
   * trigram overlap is weaker evidence than an embedding and must not be
   * allowed to auto-confirm on its own.
   */
  semanticSimilarity?: number;
}

/**
 * The matching pipeline.
 *
 * Pure: two inputs in, a decision out, no database, no network, no clock.
 * That is what makes the highest-risk module in the system exhaustively
 * testable against a golden set on every commit.
 *
 * Order matters and is not interchangeable:
 *
 *   1. score the three layers independently
 *   2. blend them, renormalising over the layers that actually applied
 *   3. apply CAPS where the evidence is too thin to auto-confirm
 *   4. apply VETOES, which override everything above
 *
 * Vetoes run last because they answer a different question from the score.
 * "How similar are these?" and "could these possibly be the same product?"
 * are independent, and letting similarity outvote a confirmed capacity
 * difference is precisely the failure this design exists to prevent.
 */
export function matchProducts(
  a: MatchInput,
  b: MatchInput,
  options: MatchOptions = {},
): MatchResult {
  const identifier = analyzeIdentifiers(a, b);
  const attribute = analyzeAttributes(a, b);

  const usingEmbedding = options.semanticSimilarity !== undefined;
  const semantic: LayerResult = usingEmbedding
    ? {
        score: clamp(options.semanticSimilarity!),
        applicable: true,
        evidence: [`embedding cosine ${options.semanticSimilarity!.toFixed(3)}`],
      }
    : lexicalSimilarity(a.title, b.title);

  const explanation: string[] = [
    ...identifier.evidence,
    ...attribute.evidence,
    ...semantic.evidence,
  ];

  // --- blend ---------------------------------------------------------------
  // Renormalise over applicable layers only. Scoring an inapplicable layer as
  // zero would mean a genuine match with no published barcode could never
  // exceed 0.60, so it would be rejected for lacking data rather than for
  // being wrong.
  let weighted = 0;
  let totalWeight = 0;

  if (identifier.applicable) {
    weighted += identifier.score * WEIGHTS.identifier;
    totalWeight += WEIGHTS.identifier;
  }
  if (attribute.applicable) {
    weighted += attribute.score * WEIGHTS.attribute;
    totalWeight += WEIGHTS.attribute;
  }
  if (semantic.applicable) {
    weighted += semantic.score * WEIGHTS.semantic;
    totalWeight += WEIGHTS.semantic;
  }

  let confidence = totalWeight > 0 ? weighted / totalWeight : 0;

  // --- caps ----------------------------------------------------------------
  // Renormalisation alone is too generous: a pair with ONLY semantic evidence
  // would renormalise to whatever the cosine was and could auto-confirm on
  // title similarity, which is exactly how a phone gets paired with its case.
  // Caps hold such pairs just under the auto-confirm line so a human decides.
  let capReason: string | undefined;
  const cap = (limit: number, reason: string): void => {
    if (confidence > limit) {
      confidence = limit;
      capReason = reason;
    }
  };

  /**
   * A matching GTIN is CONCLUSIVE and exempts the pair from the evidence caps
   * below.
   *
   * A GTIN is manufacturer-assigned, globally unique and check-digit
   * protected — two listings carrying the same valid barcode are the same
   * physical product. Holding such a pair back because we happen to lack an
   * embedding would route every correctly-identified product to a human queue
   * and defeat the purpose of having identifiers at all.
   *
   * This is safe because vetoes run AFTER the caps and override them: a
   * shared GTIN still loses to an accessory, condition or attribute veto.
   */
  const conclusiveIdentifier = identifier.gtin === 'match';

  /**
   * FLOOR on a confirmed barcode match.
   *
   * The 40/30/30 blend exists to weigh circumstantial evidence when the
   * product cannot be identified outright. Once it CAN be — same valid GTIN —
   * the blend is answering a question that is already settled, and letting a
   * weak title score drag it below the threshold is simply wrong: the two
   * marketplaces describing one product as "Wireless Headphones" and
   * "Bluetooth Headset" is a naming difference, not evidence of two products.
   *
   * Applied before the caps so a price-implausibility cap can still pull it
   * back to review, and before vetoes, which override it entirely.
   */
  if (conclusiveIdentifier) {
    confidence = Math.max(confidence, 0.95);
    explanation.push('GTIN match is conclusive: confidence floored at 0.95');
  }

  if (!identifier.applicable) {
    cap(0.8, 'no identifiers (brand/model/GTIN) available on either side');
  } else if (!conclusiveIdentifier && identifier.model !== 'match') {
    cap(0.84, 'neither GTIN nor model number confirmed');
  }

  if (!attribute.applicable && !conclusiveIdentifier) {
    cap(0.8, 'no comparable attributes published by either marketplace');
  }

  // Lexical overlap is materially weaker evidence than an embedding — it
  // cannot tell that "Natural Titanium" and "Titanium Natural" are the same
  // finish, and it rates a phone and its case very highly. So it may not
  // auto-confirm on its own; a confirmed barcode is exempt per the above.
  if (!usingEmbedding && !conclusiveIdentifier) {
    cap(0.82, 'semantic layer using lexical fallback (embeddings arrive in Phase 10)');
  }

  if (a.category === 'OTHER' || b.category === 'OTHER') {
    cap(0.8, 'uncategorised product: no attribute veto rules apply');
  }

  if (isPriceImplausible(a, b)) {
    cap(0.7, 'prices differ by more than 3x');
  }

  // --- vetoes --------------------------------------------------------------
  const veto = applyVetoes(a, b, identifier, attribute);
  if (veto.vetoed) {
    explanation.push(`VETO ${veto.reason}: ${veto.detail ?? ''}`.trim());
    return {
      decision: 'REJECTED',
      // Zeroed deliberately. Retaining a high score on a vetoed pair invites
      // someone to sort the review queue by confidence and "rescue" it.
      confidence: 0,
      identifier,
      attribute,
      semantic,
      vetoReason: veto.reason,
      explanation,
      pipelineVersion: PIPELINE_VERSION,
    };
  }

  if (capReason) explanation.push(`CAP: ${capReason}`);

  const decision =
    confidence >= THRESHOLDS.autoConfirm
      ? 'AUTO_CONFIRMED'
      : confidence >= THRESHOLDS.review
        ? 'NEEDS_REVIEW'
        : 'REJECTED';

  return {
    decision,
    confidence: round4(confidence),
    identifier,
    attribute,
    semantic,
    capReason,
    explanation,
    pipelineVersion: PIPELINE_VERSION,
  };
}

/**
 * Canonical ordering for a pair, matching the unique constraint on
 * product_matches(listing_a_id, listing_b_id). Ensures a pair scored in
 * either direction dedupes to one row.
 */
export function canonicalPairOrder<T extends { externalId: string }>(
  a: T,
  b: T,
): [T, T] {
  return a.externalId <= b.externalId ? [a, b] : [b, a];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
