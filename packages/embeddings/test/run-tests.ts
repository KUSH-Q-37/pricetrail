/**
 * Embeddings test suite.
 *
 * Part 1 (text builder, cosine, literals) is pure and fast.
 * Part 2 downloads and runs the real model — slow on first run (~30 MB), then
 * cached. Skip it with SKIP_MODEL=1.
 */
import { LocalOnnxEmbeddingProvider } from '../src/local-onnx.provider';
import {
  EMBEDDING_DIMENSION,
  cosineSimilarity,
  fromVectorLiteral,
  toVectorLiteral,
} from '../src/provider';
import { buildEmbeddingText } from '../src/text-builder';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    failures.push(`  ${name}\n      expected ${e}\n      actual   ${a}`);
  }
}

/**
 * Float comparison with tolerance.
 *
 * Asserting exact equality on floating-point arithmetic is the bug, not the
 * result: cosine([1,1],[5,5]) is 0.9999999999999998 in IEEE-754 because the
 * magnitudes are computed via sqrt. Nothing downstream cares about the 16th
 * decimal place.
 */
function checkClose(name: string, actual: number, expected: number, epsilon = 1e-9): void {
  if (Math.abs(actual - expected) <= epsilon) passed++;
  else {
    failed++;
    failures.push(`  ${name}\n      expected ~${expected}\n      actual    ${actual}`);
  }
}

const section = (title: string) => console.log(`\n=== ${title} ===`);

// ---------------------------------------------------------------------------
section('TEXT BUILDER');
// ---------------------------------------------------------------------------
check(
  'brand and model lead the text',
  buildEmbeddingText({ title: 'iPhone 15 Pro', brand: 'Apple', modelNumber: 'A3102' }),
  'apple a3102 iphone 15 pro',
);

// Marketplace marketing noise pushes identical products apart in vector space.
check(
  'boilerplate stripped',
  buildEmbeddingText({ title: 'Sony WH-1000XM5 Buy Online at Best Price in India Free Delivery' }),
  'sony wh 1000xm5',
);
check(
  'warranty phrasing stripped',
  buildEmbeddingText({ title: 'LG Refrigerator with 2 Year Warranty' }),
  'lg refrigerator',
);

// Repeating the brand inflates its weight in the pooled vector for no reason.
check(
  'duplicate tokens removed',
  buildEmbeddingText({ title: 'Apple iPhone 15 Pro', brand: 'Apple' }),
  'apple iphone 15 pro',
);

check(
  'attributes appended with units',
  buildEmbeddingText({
    title: 'Galaxy S24',
    brand: 'Samsung',
    attributes: { storage_gb: 512, ram_gb: 12, colour: 'titanium grey' },
  }),
  'samsung galaxy s24 512 gb storage 12 ram titanium grey',
);

// Fixed key order: two listings with the same attributes inserted in different
// orders must produce byte-identical text, or they embed to different vectors.
check(
  'attribute order is insertion-independent',
  buildEmbeddingText({ title: 'X', attributes: { ram_gb: 8, storage_gb: 256 } }),
  buildEmbeddingText({ title: 'X', attributes: { storage_gb: 256, ram_gb: 8 } }),
);

check(
  'case and punctuation normalised',
  buildEmbeddingText({ title: 'APPLE iPhone 15 Pro (Natural Titanium, 256 GB)' }),
  'apple iphone 15 pro natural titanium 256 gb',
);
check('OTHER category omitted', buildEmbeddingText({ title: 'Thing', category: 'OTHER' }), 'thing');

// ---------------------------------------------------------------------------
section('COSINE + PGVECTOR LITERALS');
// ---------------------------------------------------------------------------
checkClose('identical vectors', cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
checkClose('orthogonal vectors', cosineSimilarity([1, 0], [0, 1]), 0);
checkClose('opposite vectors', cosineSimilarity([1, 0], [-1, 0]), -1);
check('zero vector is safe', cosineSimilarity([0, 0], [1, 1]), 0);
checkClose('scale invariant', cosineSimilarity([1, 1], [5, 5]), 1);
// Never exceed 1.0 — a downstream `<= 1` assertion would fail on drift.
check('clamped to 1', cosineSimilarity([1, 1], [5, 5]) <= 1, true);

{
  let threw = false;
  try {
    cosineSimilarity([1, 2, 3], [1, 2]);
  } catch {
    threw = true;
  }
  check('dimension mismatch throws', threw, true);
}

{
  const vector = Array.from({ length: EMBEDDING_DIMENSION }, (_, i) => i / 1000);
  const literal = toVectorLiteral(vector);
  check('literal starts with [', literal.startsWith('['), true);
  check('literal round-trips', fromVectorLiteral(literal).length, EMBEDDING_DIMENSION);
  check('values survive round-trip', fromVectorLiteral(literal)[42], vector[42]);

  let threw = false;
  try {
    toVectorLiteral([1, 2, 3]);
  } catch {
    threw = true;
  }
  check('wrong dimension rejected', threw, true);
}

// ---------------------------------------------------------------------------
async function modelTests(): Promise<void> {
  if (process.env['SKIP_MODEL'] === '1') {
    console.log('\n=== MODEL (skipped via SKIP_MODEL=1) ===');
    return;
  }

  section('REAL MODEL (bge-small-en-v1.5, downloads on first run)');

  const provider = new LocalOnnxEmbeddingProvider();
  const started = Date.now();

  const texts = [
    buildEmbeddingText({
      title: 'Apple iPhone 15 Pro (256 GB) - Natural Titanium',
      brand: 'Apple',
      attributes: { storage_gb: 256 },
    }),
    buildEmbeddingText({
      title: 'APPLE iPhone 15 Pro (Natural Titanium, 256 GB)',
      brand: 'APPLE',
      attributes: { storage_gb: 256 },
    }),
    buildEmbeddingText({
      title: 'Apple Silicone Case with MagSafe for iPhone 15 Pro',
      brand: 'Apple',
    }),
    buildEmbeddingText({
      title: 'LG 260 L 3 Star Frost Free Double Door Refrigerator',
      brand: 'LG',
      attributes: { capacity_l: 260, star_rating: 3 },
    }),
  ];

  const results = await provider.embed(texts);
  const elapsed = Date.now() - started;

  check('one vector per input', results.length, 4);
  check('dimension is 384', results[0]!.vector.length, EMBEDDING_DIMENSION);
  check('model id recorded', results[0]!.model, 'Xenova/bge-small-en-v1.5');

  // The provider requests normalize:true; pgvector's cosine ops assume it.
  const magnitude = Math.sqrt(results[0]!.vector.reduce((sum, v) => sum + v * v, 0));
  check('vectors are L2-normalised', Math.abs(magnitude - 1) < 0.01, true);

  const sameProduct = cosineSimilarity(results[0]!.vector, results[1]!.vector);
  const phoneVsCase = cosineSimilarity(results[0]!.vector, results[2]!.vector);
  const phoneVsFridge = cosineSimilarity(results[0]!.vector, results[3]!.vector);

  console.log(`  load + embed 4 texts : ${elapsed}ms`);
  console.log(`  same product         : ${sameProduct.toFixed(4)}`);
  console.log(`  phone vs its case    : ${phoneVsCase.toFixed(4)}`);
  console.log(`  phone vs fridge      : ${phoneVsFridge.toFixed(4)}`);

  check('same product scores very high', sameProduct > 0.9, true);
  check('unrelated products score lower', phoneVsFridge < sameProduct, true);
  check('phone/fridge clearly separated', phoneVsFridge < 0.8, true);

  // The point of the accessory veto: an embedding CANNOT be trusted to
  // separate a phone from its own case, and this measures how close they are.
  console.log(
    `  NOTE: phone vs case is ${phoneVsCase.toFixed(4)} — this is why the accessory veto exists`,
  );

  let threw = false;
  try {
    await provider.embed(['']);
  } catch {
    threw = true;
  }
  check('empty text rejected', threw, true);

  await provider.dispose();
}

void modelTests()
  .catch((error: unknown) => {
    failed++;
    failures.push(`  model tests threw: ${String(error)}`);
  })
  .finally(() => {
    console.log(`\n${'='.repeat(60)}`);
    if (failed > 0) console.log(`FAILURES:\n${failures.join('\n')}`);
    console.log(`${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
