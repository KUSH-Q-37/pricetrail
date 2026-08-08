export type MarketplacePlatform = 'AMAZON' | 'FLIPKART';

export interface ParsedMarketplaceUrl {
  platform: MarketplacePlatform;
  /** ASIN on Amazon, FSN on Flipkart. Unique per platform. */
  externalId: string;
  /** Tracking-free URL safe to store and re-fetch. */
  canonicalUrl: string;
}

export type UrlParseFailure =
  | 'MALFORMED_URL'
  | 'UNSUPPORTED_SCHEME'
  | 'UNSUPPORTED_HOST'
  | 'SHORTENED_URL'
  | 'NO_PRODUCT_ID';

export class MarketplaceUrlError extends Error {
  readonly reason: UrlParseFailure;

  constructor(reason: UrlParseFailure, message: string) {
    super(message);
    this.name = 'MarketplaceUrlError';
    this.reason = reason;
  }
}

/**
 * Host allowlist.
 *
 * Exact hostnames, never a suffix match. `endsWith('amazon.in')` would happily
 * accept `evil-amazon.in` and `amazon.in.attacker.com`. That matters beyond
 * data hygiene: from Phase 7 the scraper fetches whatever URL is stored here,
 * so a permissive check becomes server-side request forgery.
 */
const AMAZON_HOSTS = new Set(['amazon.in', 'www.amazon.in']);
const FLIPKART_HOSTS = new Set(['flipkart.com', 'www.flipkart.com', 'dl.flipkart.com']);

/** Link shorteners we recognise well enough to reject with a useful message. */
const SHORTENER_HOSTS = new Set([
  'amzn.to',
  'amzn.eu',
  'a.co',
  'fkrt.it',
  'fkrt.cc',
  'dl.flipkart.com/dl',
]);

/**
 * Amazon Standard Identification Number: exactly 10 chars, uppercase
 * alphanumeric. Modern products start with B0, but books use their ISBN-10,
 * which is digits with an optional trailing X — so the pattern stays broad and
 * the length check does the work.
 */
const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/** Flipkart Serial Number, e.g. MOBGTAGPTB3VS24W. */
const FSN_PATTERN = /^[A-Z0-9]{12,20}$/;

function normalizeHost(hostname: string): string {
  // Trailing dots make `amazon.in.` a distinct hostname that resolves
  // identically — strip it before comparing against the allowlist.
  return hostname.toLowerCase().replace(/\.$/, '');
}

function extractAsin(url: URL): string | undefined {
  const segments = url.pathname.split('/').filter(Boolean);

  // /dp/<ASIN>, /gp/product/<ASIN>, /product/<ASIN>, and the SEO-slug variant
  // /<slug>/dp/<ASIN> all place the id immediately after a known marker.
  const markers = ['dp', 'product', 'gp'];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment && markers.includes(segment)) {
      for (let j = i + 1; j < Math.min(i + 3, segments.length); j++) {
        const candidate = segments[j]?.toUpperCase();
        if (candidate && ASIN_PATTERN.test(candidate)) return candidate;
      }
    }
  }

  // Some share links carry it as a query parameter instead.
  for (const key of ['asin', 'ASIN']) {
    const value = url.searchParams.get(key)?.toUpperCase();
    if (value && ASIN_PATTERN.test(value)) return value;
  }

  return undefined;
}

function extractFsn(url: URL): string | undefined {
  // `pid` is the canonical product identity. The /p/itm… segment identifies a
  // listing page, and the same product reached from different entry points can
  // carry different itm values — so pid is preferred whenever present.
  const pid = url.searchParams.get('pid')?.toUpperCase();
  if (pid && FSN_PATTERN.test(pid)) return pid;

  const segments = url.pathname.split('/').filter(Boolean);
  const index = segments.indexOf('p');
  const itm = index >= 0 ? segments[index + 1] : undefined;
  if (itm && /^itm[a-z0-9]+$/i.test(itm)) return itm.toUpperCase();

  return undefined;
}

/**
 * Parse a marketplace product URL into a platform and stable identifier.
 *
 * Throws MarketplaceUrlError with a specific `reason` so the API can map each
 * failure to a message that tells the user what to do differently — "this is a
 * shortened link, paste the full one" is actionable in a way that
 * "invalid URL" is not.
 */
export function parseMarketplaceUrl(input: string): ParsedMarketplaceUrl {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new MarketplaceUrlError('MALFORMED_URL', 'No URL was provided');
  }

  // Check the scheme BEFORE any normalisation.
  //
  // The convenience of accepting a bare "www.amazon.in/dp/..." paste means
  // prefixing "https://" when no scheme is present. Doing that first would
  // rewrite "file:///etc/passwd" into "https://file:///etc/passwd", which
  // parses as host "file" and gets rejected as an unsupported *host* — still
  // safe, but the user is told the wrong thing. Detecting an explicit scheme
  // up front keeps each rejection reason accurate.
  const hasScheme = /^[a-z][a-z0-9+.\-]*:/i.test(trimmed);
  const isHttpScheme = /^https?:\/\//i.test(trimmed);

  if (hasScheme && !isHttpScheme) {
    throw new MarketplaceUrlError(
      'UNSUPPORTED_SCHEME',
      'Only http and https links are supported',
    );
  }

  let url: URL;
  try {
    url = new URL(isHttpScheme ? trimmed : `https://${trimmed}`);
  } catch {
    throw new MarketplaceUrlError('MALFORMED_URL', 'That does not look like a URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new MarketplaceUrlError(
      'UNSUPPORTED_SCHEME',
      'Only http and https links are supported',
    );
  }

  const host = normalizeHost(url.hostname);

  if (SHORTENER_HOSTS.has(host)) {
    throw new MarketplaceUrlError(
      'SHORTENED_URL',
      'Shortened links cannot be read directly. Open the link and paste the full product URL.',
    );
  }

  if (AMAZON_HOSTS.has(host)) {
    const asin = extractAsin(url);
    if (!asin) {
      throw new MarketplaceUrlError(
        'NO_PRODUCT_ID',
        'No ASIN found in that Amazon link. Make sure it points at a product page.',
      );
    }
    return {
      platform: 'AMAZON',
      externalId: asin,
      canonicalUrl: `https://www.amazon.in/dp/${asin}`,
    };
  }

  if (FLIPKART_HOSTS.has(host)) {
    const fsn = extractFsn(url);
    if (!fsn) {
      throw new MarketplaceUrlError(
        'NO_PRODUCT_ID',
        'No product id found in that Flipkart link. Make sure it points at a product page.',
      );
    }
    return {
      platform: 'FLIPKART',
      externalId: fsn,
      canonicalUrl: `https://www.flipkart.com${url.pathname}?pid=${fsn}`,
    };
  }

  throw new MarketplaceUrlError(
    'UNSUPPORTED_HOST',
    'Only amazon.in and flipkart.com product links are supported',
  );
}

/** Non-throwing variant for callers that treat failure as an ordinary branch. */
export function tryParseMarketplaceUrl(
  input: string,
): ParsedMarketplaceUrl | undefined {
  try {
    return parseMarketplaceUrl(input);
  } catch {
    return undefined;
  }
}

/** Cheap check used by the search box to decide "is this a URL or a query?". */
export function looksLikeMarketplaceUrl(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return (
    trimmed.includes('amazon.in') ||
    trimmed.includes('flipkart.com') ||
    trimmed.includes('amzn.') ||
    trimmed.includes('fkrt.')
  );
}
