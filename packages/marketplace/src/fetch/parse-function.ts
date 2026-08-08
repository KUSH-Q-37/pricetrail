import type { RawFetchedProduct } from '../product-data.schema';

export interface ParseContext {
  externalId: string;
  url: string;
  source: 'API' | 'SCRAPE';
}

/**
 * A platform's HTML parser.
 *
 * Pure and synchronous by contract: HTML in, unvalidated fields out, no I/O.
 * That is what lets every parser be tested from saved fixtures with no network
 * and no browser — and it is what allows the HTTP and browser fetch strategies
 * below to share one implementation, differing only in how they obtained the
 * HTML.
 *
 * May throw BotChallengeError. Must not throw for merely missing fields —
 * leaving them undefined lets the boundary schema report precisely which one
 * was absent.
 */
export type ParseFunction = (html: string, context: ParseContext) => RawFetchedProduct;
