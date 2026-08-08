import { describe, expect, it } from 'vitest';

import { normalizeAvailability } from '../src/shared/availability';
import { computeDiscountPercent, parsePriceToMinor } from '../src/shared/price';
import {
  extractCapacity,
  extractMemory,
  extractStarRating,
  normalizeAttributes,
} from '../src/shared/attributes';
import { normalizeTitle, parseRating, parseReviewCount } from '../src/shared/text';
import { MarketplaceUrlError, parseMarketplaceUrl } from '../src/url-parser';

describe('Indian price parsing', () => {
  it.each([
    ['₹1,29,999.00', 12999900],
    ['₹129,999.00', 12999900],
    ['₹28,990', 2899000],
    ['Rs. 1,299', 129900],
    ['1,29,999', 12999900],
    ['₹ 1,29,999.00', 12999900],
    ['₹ 1,29,999.00', 12999900],
    ['₹1,299.50', 129950],
    ['₹1,299.5', 129950],
  ])('parses %s', (input, expected) => {
    expect(parsePriceToMinor(input)).toBe(expected);
  });

  it('takes the FIRST value when Amazon renders the price twice', () => {
    // `.a-price` emits the value once in `.a-offscreen` for screen readers and
    // again split across whole/fraction. A careless `.text()` concatenates
    // them; stripping non-digits from that yields a number ten orders of
    // magnitude too large that still parses as valid.
    expect(parsePriceToMinor('₹1,34,999.00₹1,34,999.00')).toBe(13499900);
  });

  it.each([
    ['', undefined],
    [null, undefined],
    ['Currently unavailable', undefined],
    ['₹0', undefined],
    ['₹0.00', undefined],
    ['₹99,99,99,999', undefined],
  ])('rejects %s rather than guessing', (input, expected) => {
    expect(parsePriceToMinor(input)).toBe(expected);
  });
});

describe('discount', () => {
  it('computes from MRP', () => {
    expect(computeDiscountPercent(13499900, 14990000)).toBe(10);
  });

  it('returns undefined when there is no genuine discount', () => {
    // undefined, not 0 — so the UI can tell "no offer" from "0% off".
    expect(computeDiscountPercent(1000, 1000)).toBeUndefined();
    expect(computeDiscountPercent(2000, 1000)).toBeUndefined();
    expect(computeDiscountPercent(undefined, 1000)).toBeUndefined();
  });
});

describe('availability — rule ORDER is the design', () => {
  it('does not let "only 2 left in stock" read as freely available', () => {
    // It contains the substring "in stock". A contains-check classifies a
    // nearly sold-out item as available.
    expect(normalizeAvailability('Only 2 left in stock.')).toBe('LIMITED_STOCK');
  });

  it.each([
    ['In stock', 'IN_STOCK'],
    ['Usually dispatched in 2 days', 'IN_STOCK'],
    ['Currently unavailable.', 'OUT_OF_STOCK'],
    ['Temporarily out of stock', 'OUT_OF_STOCK'],
    ['Available for pre-order', 'PREORDER'],
    ['This item is no longer available', 'DISCONTINUED'],
  ])('classifies %s', (input, expected) => {
    expect(normalizeAvailability(input)).toBe(expected);
  });

  it('stays UNKNOWN rather than guessing IN_STOCK', () => {
    // An unrecognised phrase defaulting to "in stock" would let a delisted
    // product keep recording prices as if it were on sale.
    expect(normalizeAvailability('Ships from Amazon')).toBe('UNKNOWN');
    expect(normalizeAvailability('')).toBe('UNKNOWN');
  });
});

describe('schema.org availability (Flipkart JSON-LD vocabulary)', () => {
  it.each([
    ['https://schema.org/InStock', 'IN_STOCK'],
    ['https://schema.org/OutOfStock', 'OUT_OF_STOCK'],
    ['https://schema.org/SoldOut', 'OUT_OF_STOCK'],
    ['https://schema.org/LimitedAvailability', 'LIMITED_STOCK'],
    ['https://schema.org/PreOrder', 'PREORDER'],
    ['https://schema.org/BackOrder', 'PREORDER'],
    ['https://schema.org/Discontinued', 'DISCONTINUED'],
    ['http://schema.org/InStock', 'IN_STOCK'],
  ])('maps %s', (input, expected) => {
    // The enumerated branch must beat the free-text rules: "OutOfStock"
    // contains "Stock", and "LimitedAvailability" contains "Availability".
    expect(normalizeAvailability(input)).toBe(expected);
  });

  it('returns UNKNOWN for an unrecognised schema.org term', () => {
    expect(normalizeAvailability('https://schema.org/Nonsense')).toBe('UNKNOWN');
  });
});

describe('text and ratings', () => {
  it('normalises titles for trigram search', () => {
    expect(normalizeTitle('Apple iPhone 15 Pro (256 GB) - Natural Titanium')).toBe(
      'apple iphone 15 pro 256 gb natural titanium',
    );
  });

  it('keeps model-number tokens separable', () => {
    // Hyphens become spaces rather than vanishing, so "GL-S292RPZX" does not
    // fuse with neighbouring words.
    expect(normalizeTitle('LG GL-S292RPZX')).toBe('lg gl s292rpzx');
  });

  it('parses ratings and clamps to the 0-5 scale', () => {
    expect(parseRating('4.6 out of 5 stars')).toBe(4.6);
    expect(parseRating('4.3')).toBe(4.3);
    expect(parseRating('9.9 out of 5 stars')).toBeUndefined();
  });

  it('parses review counts including K/M suffixes', () => {
    expect(parseReviewCount('3,421 ratings')).toBe(3421);
    expect(parseReviewCount('1.2K reviews')).toBe(1200);
  });
});

describe('attribute extraction', () => {
  it('disambiguates RAM from storage by keyword, not position', () => {
    expect(extractMemory('8 GB RAM | 256 GB Storage')).toEqual({
      ram_gb: 8,
      storage_gb: 256,
    });
  });

  it('converts TB to GB and treats a bare size as storage', () => {
    expect(extractMemory('1 TB SSD')).toEqual({ storage_gb: 1024 });
    expect(extractMemory('256 GB')).toEqual({ storage_gb: 256 });
  });

  it('keeps appliance capacities in separate units', () => {
    // Litres, kg and tons identify different product families; one ambiguous
    // `capacity` number would let a fridge match a washing machine.
    expect(extractCapacity('260 Litres')).toEqual({ capacity_l: 260 });
    expect(extractCapacity('7 kg washing machine')).toEqual({ capacity_kg: 7 });
    expect(extractCapacity('1.5 Ton Split AC')).toEqual({ capacity_ton: 1.5 });
  });

  it('reads BEE star ratings', () => {
    expect(extractStarRating('3 Star Energy Rating')).toBe(3);
    expect(extractStarRating('5-Star')).toBe(5);
  });

  it('folds a spec table into normalised attributes', () => {
    expect(
      normalizeAttributes({
        RAM: '8 GB',
        'Internal Storage': '256 GB',
        Colour: 'Natural Titanium',
        'Item model number': 'A3102',
      }),
    ).toEqual({
      ram_gb: 8,
      storage_gb: 256,
      colour: 'natural titanium',
      model_number: 'A3102',
    });
  });
});

describe('marketplace URL parsing', () => {
  it.each([
    ['https://www.amazon.in/dp/B0CHX1W1XY', 'AMAZON', 'B0CHX1W1XY'],
    ['https://www.amazon.in/Apple-iPhone/dp/B0CHX1W1XY/ref=sr_1_1?k=x', 'AMAZON', 'B0CHX1W1XY'],
    ['https://www.amazon.in/gp/product/B0CHX1W1XY', 'AMAZON', 'B0CHX1W1XY'],
    ['https://amazon.in/dp/b0chx1w1xy', 'AMAZON', 'B0CHX1W1XY'],
    ['www.amazon.in/dp/B0CHX1W1XY', 'AMAZON', 'B0CHX1W1XY'],
    [
      'https://www.flipkart.com/apple-iphone/p/itm6ac6485515ae4?pid=MOBGTAGPTB3VS24W',
      'FLIPKART',
      'MOBGTAGPTB3VS24W',
    ],
    ['https://www.flipkart.com/lg-260-l/p/itm9f8a7b6c5d4e3', 'FLIPKART', 'ITM9F8A7B6C5D4E3'],
  ])('parses %s', (url, platform, externalId) => {
    const parsed = parseMarketplaceUrl(url);
    expect(parsed.platform).toBe(platform);
    expect(parsed.externalId).toBe(externalId);
  });

  it.each([
    ['https://amzn.to/3xYz', 'SHORTENED_URL'],
    // Host matching is EXACT. A suffix check would accept these, and from
    // Phase 7 onward the fetcher requests whatever URL is stored — a
    // permissive host check becomes server-side request forgery.
    ['https://evil-amazon.in/dp/B0CHX1W1XY', 'UNSUPPORTED_HOST'],
    ['https://amazon.in.attacker.com/dp/B0CHX1W1XY', 'UNSUPPORTED_HOST'],
    ['https://www.myntra.com/p/1', 'UNSUPPORTED_HOST'],
    ['file:///etc/passwd', 'UNSUPPORTED_SCHEME'],
    ['javascript:alert(1)', 'UNSUPPORTED_SCHEME'],
    ['https://www.amazon.in/', 'NO_PRODUCT_ID'],
    ['https://www.amazon.in/dp/TOOSHORT', 'NO_PRODUCT_ID'],
    ['not a url at all', 'MALFORMED_URL'],
    ['', 'MALFORMED_URL'],
  ])('rejects %s with reason %s', (url, reason) => {
    try {
      parseMarketplaceUrl(url);
      throw new Error(`expected ${url} to be rejected`);
    } catch (error) {
      expect(error).toBeInstanceOf(MarketplaceUrlError);
      expect((error as MarketplaceUrlError).reason).toBe(reason);
    }
  });
});
