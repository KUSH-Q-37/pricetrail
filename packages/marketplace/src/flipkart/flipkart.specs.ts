/**
 * Extract Flipkart's specification table from the embedded page state.
 *
 * Why this exists
 * ---------------
 * Nothing was reading specifications at all. Every scraped listing had
 * `raw_attributes = {}` — 19 of 19 in the development database — which meant
 * the product's attribute map stayed empty and its category stayed OTHER.
 *
 * That is not a cosmetic gap. The matching pipeline renormalises its weights
 * over *applicable* layers, and an empty attribute map makes the attribute
 * layer inapplicable, which triggers `cap(0.8, 'no comparable attributes
 * published by either marketplace')`. With that cap in force nothing can ever
 * reach the auto-confirm threshold unless both sides publish the same barcode
 * — and Flipkart product pages usually do not. So Amazon/Flipkart pairs that
 * were obviously the same phone scored 0.57 and were rejected, and the
 * canonical-product merge could never fire.
 *
 * The matcher was working correctly on starved input.
 *
 * Where the data lives
 * --------------------
 * Not in an HTML table — there is no <td> spec grid to parse. Flipkart ships
 * the specifications inside its serialised React state, one object per row:
 *
 *   "label_1":{...,"value":{"text":["256 GB"]}},
 *   "label_0":{...,"value":{"text":"Internal Storage"}}
 *
 * `label_0` is the name and `label_1` the value(s), and they appear in that
 * order — value first, then name. Values are always an array, because a row
 * like "Sales Package" legitimately has several.
 *
 * Anchored on the shape of the payload rather than on class names, for the
 * same reason the product parser prefers JSON-LD: Flipkart rotates its class
 * hashes freely and did so mid-project, breaking every selector at once. It
 * changes the shape of its own state far less often, and when it does, this
 * returns nothing rather than returning nonsense.
 */

/**
 * One specification row.
 *
 * The gap between each anchor and its `"value"` is bounded by LENGTH rather
 * than by "no braces". The obvious `[^{}]*` fails outright: the real payload
 * carries `"properties":{},"visible":true` between them, so braces genuinely
 * do occur inside a single row.
 *
 * A bound is still needed, and lazily matching up to 200 characters is what
 * keeps the match inside one object. Without it a greedy scan would happily
 * pair one row's value with a much later row's name and produce specifications
 * that look entirely plausible and are wrong — the worst possible failure for
 * something feeding a matching engine.
 */
const SPEC_ROW =
  /"label_1":\{[\s\S]{0,200}?"value":\{"text":\[([^\]]*)\]\}\},"label_0":\{[\s\S]{0,200}?"value":\{"text":"([^"]+)"\}/g;

/** Quoted strings inside the value array. */
const QUOTED = /"([^"]*)"/g;

/** Flipkart escapes '/' as / in this payload; JSON.parse is not available on a fragment. */
function decode(value: string): string {
  return value.replace(/\\u002f/gi, '/').replace(/\\u0026/gi, '&').replace(/\s+/g, ' ').trim();
}

/**
 * Upper bound on rows kept, purely to stop the payload being unbounded.
 *
 * Set high on purpose. An earlier value of 60 looked generous and quietly
 * broke matching: Flipkart emits its rows in page order, so the cap was spent
 * on camera and display trivia before ever reaching "Internal Storage", and
 * the normaliser fell through to a bare "N GB" scan that picked a number out
 * of some unrelated sentence. Truncating a specification table is not a
 * neutral saving — it silently changes which facts the matcher gets to see,
 * and the useful ones are not at the top.
 *
 * These are short strings; 250 of them is a few KB per listing.
 */
const MAX_SPECS = 250;

export function parseFlipkartSpecifications(html: string): Record<string, string> {
  const specs: Record<string, string> = {};

  for (const match of html.matchAll(SPEC_ROW)) {
    if (Object.keys(specs).length >= MAX_SPECS) break;

    const name = decode(match[2] ?? '');
    if (!name) continue;

    const values = [...(match[1] ?? '').matchAll(QUOTED)]
      .map((quoted) => decode(quoted[1] ?? ''))
      .filter(Boolean);

    if (values.length === 0) continue;

    // First occurrence wins. Flipkart repeats the highlights block above the
    // full table, and the later copy is not richer — just duplicated.
    if (specs[name] === undefined) {
      specs[name] = values.join(', ');
    }
  }

  return specs;
}
