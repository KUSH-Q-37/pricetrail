import { getCategorySchema, type AttributeDefinition } from '../schemas/category-schema';
import type { LayerResult, MatchInput } from '../types';

export interface AttributeComparison {
  key: string;
  outcome: 'match' | 'mismatch' | 'unknown';
  veto: boolean;
  left?: string | number;
  right?: string | number;
}

export interface AttributeAnalysis extends LayerResult {
  comparisons: AttributeComparison[];
  /** Veto-eligible keys that CONFLICT. Non-empty means reject. */
  vetoViolations: AttributeComparison[];
}

/**
 * Layer 2 — attribute matching. Weight 0.30.
 *
 * Category-dispatched: a phone is compared on storage and RAM, a refrigerator
 * on capacity and star rating. One flat comparator would either miss the
 * distinctions that matter per category or apply nonsense ones (a fridge has
 * no RAM).
 *
 * This layer also produces the veto violations. That is deliberate — the same
 * comparison that scores "storage differs" is the one that must reject the
 * pair, and deriving them separately invites the two to disagree.
 */
export function analyzeAttributes(a: MatchInput, b: MatchInput): AttributeAnalysis {
  // Comparing a phone against a refrigerator is meaningless; the category
  // veto in vetoes.ts handles the rejection, this just avoids scoring it.
  const schema = getCategorySchema(a.category);
  const comparisons: AttributeComparison[] = [];
  const evidence: string[] = [];

  let weightedScore = 0;
  let applicableWeight = 0;

  for (const definition of schema.attributes) {
    const left = a.attributes[definition.key];
    const right = b.attributes[definition.key];
    const outcome = compareValues(left, right, definition);

    comparisons.push({
      key: definition.key,
      outcome,
      veto: definition.veto,
      left,
      right,
    });

    if (outcome === 'unknown') continue;

    applicableWeight += definition.weight;
    if (outcome === 'match') {
      weightedScore += definition.weight;
      evidence.push(`${definition.key} matches (${String(left)})`);
    } else {
      evidence.push(
        `${definition.key} differs (${String(left)} vs ${String(right)})${definition.veto ? ' [VETO]' : ''}`,
      );
    }
  }

  const vetoViolations = comparisons.filter(
    (comparison) => comparison.veto && comparison.outcome === 'mismatch',
  );

  if (applicableWeight === 0) {
    evidence.push('no comparable attributes on either side');
    return { score: 0, applicable: false, evidence, comparisons, vetoViolations };
  }

  // Renormalise over the attributes actually present. Dividing by the schema's
  // full weight would penalise a pair for fields neither marketplace happened
  // to publish, which is a data-coverage problem rather than evidence they are
  // different products.
  return {
    score: weightedScore / applicableWeight,
    applicable: true,
    evidence,
    comparisons,
    vetoViolations,
  };
}

function compareValues(
  left: string | number | undefined,
  right: string | number | undefined,
  definition: AttributeDefinition,
): 'match' | 'mismatch' | 'unknown' {
  // Absence of evidence is never evidence of a mismatch — this is what stops
  // a veto firing on a field one marketplace simply does not publish.
  if (left === undefined || right === undefined || left === '' || right === '') {
    return 'unknown';
  }

  if (typeof left === 'number' && typeof right === 'number') {
    const tolerance = definition.tolerance ?? 0;
    return Math.abs(left - right) <= tolerance ? 'match' : 'mismatch';
  }

  const leftText = String(left).toLowerCase().trim();
  const rightText = String(right).toLowerCase().trim();
  if (!leftText || !rightText) return 'unknown';
  if (leftText === rightText) return 'match';

  // Free-text values (colour, form factor) are named inconsistently across
  // marketplaces, so containment counts as agreement: "natural titanium" and
  // "titanium" describe the same finish.
  if (leftText.includes(rightText) || rightText.includes(leftText)) return 'match';

  return 'mismatch';
}
