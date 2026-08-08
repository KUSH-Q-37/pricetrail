import { cleanText } from './text';

/**
 * Normalized attribute values extracted from a specification table.
 *
 * These feed matching Layer 2. Several are veto-eligible — a mismatch on
 * `storage_gb` REJECTS a pair outright rather than lowering its score,
 * because a 128 GB and a 256 GB phone share brand, model, embedding space and
 * ~95% of their title, and a purely weighted score rates them ~0.93.
 */
export interface NormalizedAttributes {
  ram_gb?: number;
  storage_gb?: number;
  colour?: string;
  screen_in?: number;
  capacity_l?: number;
  capacity_kg?: number;
  capacity_ton?: number;
  star_rating?: number;
  model_number?: string;
  [key: string]: string | number | undefined;
}

/** Convert a capacity token to GB. TB is 1024 GB in storage marketing. */
function toGigabytes(value: number, unit: string): number | undefined {
  const normalized = unit.toLowerCase();
  if (normalized === 'tb') return value * 1024;
  if (normalized === 'gb') return value;
  if (normalized === 'mb') return value / 1024;
  return undefined;
}

const SIZE_TOKEN = /(\d+(?:\.\d+)?)\s*(TB|GB|MB)\b/i;

/**
 * RAM and storage are both expressed in GB and often appear in the same
 * string ("8 GB RAM | 256 GB Storage"), so the two are disambiguated by the
 * keyword next to the number rather than by position.
 */
export function extractMemory(input: string): {
  ram_gb?: number;
  storage_gb?: number;
} {
  const text = cleanText(input);
  const result: { ram_gb?: number; storage_gb?: number } = {};

  const ramMatch =
    /(\d+(?:\.\d+)?)\s*(TB|GB|MB)\s*(?:of\s+)?ram\b/i.exec(text) ??
    /\bram\b[\s:]*(\d+(?:\.\d+)?)\s*(TB|GB|MB)/i.exec(text);
  if (ramMatch?.[1] && ramMatch[2]) {
    const gb = toGigabytes(Number(ramMatch[1]), ramMatch[2]);
    // A phone with 2 TB of RAM is a parse error, not a product.
    if (gb !== undefined && gb > 0 && gb <= 512) result.ram_gb = gb;
  }

  const storageMatch =
    /(\d+(?:\.\d+)?)\s*(TB|GB|MB)\s*(?:internal\s+)?(?:storage|rom|ssd|hdd|memory)\b/i.exec(
      text,
    ) ??
    /\b(?:storage|rom|ssd|hdd)\b[\s:]*(\d+(?:\.\d+)?)\s*(TB|GB|MB)/i.exec(text);
  if (storageMatch?.[1] && storageMatch[2]) {
    const gb = toGigabytes(Number(storageMatch[1]), storageMatch[2]);
    if (gb !== undefined && gb > 0 && gb <= 65_536) result.storage_gb = gb;
  }

  // Bare "256 GB" with no qualifier is storage in every category we cover —
  // but only accept it when RAM was not the thing we just matched.
  if (result.storage_gb === undefined && result.ram_gb === undefined) {
    const bare = SIZE_TOKEN.exec(text);
    if (bare?.[1] && bare[2]) {
      const gb = toGigabytes(Number(bare[1]), bare[2]);
      if (gb !== undefined && gb >= 8 && gb <= 65_536) result.storage_gb = gb;
    }
  }

  return result;
}

/** Screen size in inches: "6.1 inches", `6.1"`, "6.1 inch display". */
export function extractScreenInches(input: string): number | undefined {
  const text = cleanText(input);
  const match = /(\d{1,2}(?:\.\d{1,2})?)\s*(?:inch(?:es)?|"|”|cm\s*\((\d+(?:\.\d+)?)\s*inch)/i.exec(
    text,
  );
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return value >= 1 && value <= 120 ? value : undefined;
}

/**
 * Appliance capacity. The unit determines the product family:
 * litres for refrigerators, kg for washing machines, tons for air
 * conditioners — so they are stored as separate keys rather than one
 * ambiguous `capacity` number.
 */
export function extractCapacity(input: string): {
  capacity_l?: number;
  capacity_kg?: number;
  capacity_ton?: number;
} {
  const text = cleanText(input);
  const result: {
    capacity_l?: number;
    capacity_kg?: number;
    capacity_ton?: number;
  } = {};

  const litres = /(\d{2,4})\s*(?:l|ltr|litre|liter)s?\b/i.exec(text);
  if (litres?.[1]) {
    const value = Number(litres[1]);
    if (value >= 20 && value <= 1000) result.capacity_l = value;
  }

  const kg = /(\d{1,2}(?:\.\d)?)\s*kg\b/i.exec(text);
  if (kg?.[1]) {
    const value = Number(kg[1]);
    if (value >= 1 && value <= 30) result.capacity_kg = value;
  }

  const ton = /(\d(?:\.\d)?)\s*ton(?:ne)?s?\b/i.exec(text);
  if (ton?.[1]) {
    const value = Number(ton[1]);
    if (value >= 0.5 && value <= 5) result.capacity_ton = value;
  }

  return result;
}

/** BEE energy rating: "3 Star", "5-Star". */
export function extractStarRating(input: string): number | undefined {
  const match = /\b([1-5])\s*[-\s]?star\b/i.exec(cleanText(input));
  if (!match?.[1]) return undefined;
  return Number(match[1]);
}

/**
 * Colour, normalised to lowercase.
 *
 * Deliberately NOT veto-eligible in the matching engine: marketplaces name the
 * same colour differently ("Natural Titanium" vs "Titanium Natural"), and
 * rejecting on that would discard genuine matches. It contributes to the
 * score, nothing more.
 */
export function extractColour(input: string): string | undefined {
  const text = cleanText(input).toLowerCase();
  if (!text) return undefined;
  const value = text.replace(/[^a-z\s-]/g, '').trim();
  return value.length > 0 && value.length <= 60 ? value : undefined;
}

/**
 * Fold a marketplace specification table into normalized attributes.
 *
 * Input is the raw key/value pairs as scraped; keys vary in casing, spacing
 * and wording between platforms, so matching is done on a lowercased,
 * punctuation-free form of the key.
 */
export function normalizeAttributes(
  raw: Record<string, string>,
): NormalizedAttributes {
  const result: NormalizedAttributes = {};
  const joined = Object.entries(raw)
    .map(([key, value]) => `${key} ${value}`)
    .join(' | ');

  const memory = extractMemory(joined);
  if (memory.ram_gb !== undefined) result.ram_gb = memory.ram_gb;
  if (memory.storage_gb !== undefined) result.storage_gb = memory.storage_gb;

  const capacity = extractCapacity(joined);
  Object.assign(result, capacity);

  const star = extractStarRating(joined);
  if (star !== undefined) result.star_rating = star;

  const screen = extractScreenInches(joined);
  if (screen !== undefined) result.screen_in = screen;

  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    if (/colou?r/.test(normalizedKey)) {
      const colour = extractColour(value);
      if (colour) result.colour = colour;
    }

    if (/^(model|model_number|item_model_number|model_name)$/.test(normalizedKey)) {
      const model = cleanText(value);
      if (model && model.length <= 120) result.model_number = model;
    }
  }

  return result;
}
