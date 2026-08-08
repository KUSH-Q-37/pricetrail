/**
 * Reduce an untrusted `?next=` value to a same-origin path, or `/`.
 *
 * String prefix checks are not sufficient here. The obvious guard —
 * `next.startsWith('/') && !next.startsWith('//')` — accepts `/\evil.com`,
 * and browsers normalise backslashes to forward slashes while parsing a URL,
 * so that becomes `//evil.com`: a protocol-relative URL to an attacker's host.
 * The user completes a genuine sign-in and is then handed to a lookalike site.
 *
 * Parsing against a fixed base and comparing the resulting origin delegates
 * the normalisation to the same URL implementation the browser will use, so
 * encoding tricks cannot disagree with it.
 */
const SENTINEL_ORIGIN = 'https://pricetrail.invalid';

export function safeRedirectPath(next: string | null | undefined): string {
  if (!next) return '/';

  try {
    const url = new URL(next, SENTINEL_ORIGIN);

    // Anything that resolved away from the sentinel origin was absolute,
    // protocol-relative, or normalised into one of those.
    if (url.origin !== SENTINEL_ORIGIN) return '/';

    const path = `${url.pathname}${url.search}${url.hash}`;

    // Defence in depth: a same-origin result must still look like a path.
    return path.startsWith('/') && !path.startsWith('//') ? path : '/';
  } catch {
    return '/';
  }
}
