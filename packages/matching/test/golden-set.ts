import type { MatchInput } from '../src/types';

export interface GoldenCase {
  name: string;
  /** Ground truth: are these the same purchasable product? */
  sameProduct: boolean;
  a: MatchInput;
  b: MatchInput;
  /** When set, the decision must be exactly this. */
  expectDecision?: 'AUTO_CONFIRMED' | 'NEEDS_REVIEW' | 'REJECTED';
  /** When set, the pair must be rejected for exactly this reason. */
  expectVeto?: string;
  note?: string;
}

const amazon = (over: Partial<MatchInput>): MatchInput => ({
  platform: 'AMAZON',
  externalId: 'B0DEFAULT01',
  title: '',
  category: 'AUDIO',
  attributes: {},
  ...over,
});

const flipkart = (over: Partial<MatchInput>): MatchInput => ({
  platform: 'FLIPKART',
  externalId: 'MOBDEFAULT0001',
  title: '',
  category: 'AUDIO',
  attributes: {},
  ...over,
});

/**
 * The golden set.
 *
 * Weighted heavily towards NEGATIVES, and specifically towards near-misses.
 * Distinguishing an iPhone from a refrigerator is trivial and proves nothing;
 * every expensive failure in a price tracker is a pair that looks almost
 * identical and is not. Those are the cases here.
 */
export const GOLDEN_SET: GoldenCase[] = [
  // ---------------------------------------------------------------- POSITIVES
  {
    name: 'identical tv, shared EAN',
    sameProduct: true,
    expectDecision: 'AUTO_CONFIRMED',
    a: amazon({
      title: 'Sony Bravia 139 cm (55 inches) 4K Ultra HD Smart LED Google TV KD-55X74K',
      brand: 'Sony',
      modelNumber: 'KD-55X74K',
      ean: '0195949022029',
      category: 'TELEVISION',
      attributes: { screen_in: 55, resolution: '4k', colour: 'black' },
      priceMinor: 5799000,
    }),
    b: flipkart({
      title: 'SONY Bravia 139 cm (55 inch) Ultra HD (4K) LED Smart Google TV',
      brand: 'SONY',
      modelNumber: 'KD-55X74K',
      ean: '0195949022029',
      category: 'TELEVISION',
      attributes: { screen_in: 55, resolution: '4k', colour: 'black' },
      priceMinor: 5699000,
    }),
  },
  {
    name: 'same product, Amazon reports UPC where Flipkart reports EAN',
    sameProduct: true,
    expectDecision: 'AUTO_CONFIRMED',
    note: 'UPC-12 and EAN-13 are the same numbering space; widening to GTIN-14 must make them equal',
    a: amazon({
      title: 'Sony WH-1000XM5 Wireless Headphones Black',
      brand: 'Sony',
      modelNumber: 'WH-1000XM5',
      upc: '027242923072',
      category: 'AUDIO',
      attributes: { colour: 'black' },
      priceMinor: 2699000,
    }),
    b: flipkart({
      title: 'SONY WH-1000XM5 Bluetooth Headset (Black, On the Ear)',
      brand: 'SONY',
      modelNumber: 'WH-1000XM5',
      ean: '0027242923072',
      category: 'AUDIO',
      attributes: { colour: 'black' },
      priceMinor: 2749000,
    }),
  },
  {
    name: 'same product, colour named differently',
    sameProduct: true,
    note: 'colour must NOT veto: marketplaces name finishes inconsistently',
    a: amazon({
      title: 'Samsung 138 cm (55 inches) 4K Ultra HD Smart QLED TV Titanium Grey',
      brand: 'Samsung',
      modelNumber: 'QA55Q60B',
      category: 'TELEVISION',
      attributes: { screen_in: 55, resolution: '4k', colour: 'titanium grey' },
      priceMinor: 12999900,
    }),
    b: flipkart({
      title: 'SAMSUNG 138 cm (55 inch) QLED Ultra HD (4K) Smart Tizen TV (Titanium Gray)',
      brand: 'SAMSUNG',
      modelNumber: 'QA55Q60B',
      category: 'TELEVISION',
      attributes: { screen_in: 55, resolution: '4k', colour: 'gray' },
      priceMinor: 12899900,
    }),
  },
  {
    name: 'same fridge, brand spelled with corporate suffix',
    sameProduct: true,
    a: amazon({
      title: 'LG 260 L 3 Star Frost Free Double Door Refrigerator Shiny Steel',
      brand: 'LG Electronics',
      modelNumber: 'GL-S292RPZX',
      category: 'REFRIGERATOR',
      attributes: { capacity_l: 260, star_rating: 3, colour: 'shiny steel' },
      priceMinor: 2899000,
    }),
    b: flipkart({
      title: 'LG 260 L Frost Free Double Door 3 Star Refrigerator Shiny Steel',
      brand: 'LG',
      modelNumber: 'GLS292RPZX',
      category: 'REFRIGERATOR',
      attributes: { capacity_l: 260, star_rating: 3, colour: 'shiny steel' },
      priceMinor: 2849000,
    }),
  },
  {
    name: 'genuine match with NO identifiers published anywhere',
    sameProduct: true,
    expectDecision: 'AUTO_CONFIRMED',
    note: 'relaxed rules now allow auto-confirm on titles alone',
    a: amazon({
      title: 'boAt Rockerz 550 Over Ear Bluetooth Headphones Black',
      category: 'AUDIO',
      attributes: { colour: 'black' },
      priceMinor: 149900,
    }),
    b: flipkart({
      title: 'boAt Rockerz 550 Bluetooth Headset (Black, On the Ear)',
      category: 'AUDIO',
      attributes: { colour: 'black' },
      priceMinor: 159900,
    }),
  },

  // ---------------------------------------------------------------- NEGATIVES
  {
    name: 'THE CLASSIC: same tv, 55 inch vs 65 inch',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'ATTRIBUTE_MISMATCH',
    note: 'shares brand, model, ~95% of title. Pure similarity scores this high and auto-confirms without veto.',
    a: amazon({
      title: 'Sony Bravia 139 cm (55 inches) 4K Ultra HD Smart LED Google TV',
      brand: 'Sony',
      modelNumber: 'KD-55X74K',
      category: 'TELEVISION',
      attributes: { screen_in: 55, resolution: '4k', colour: 'black' },
      priceMinor: 5799000,
    }),
    b: flipkart({
      title: 'SONY Bravia 164 cm (65 inch) Ultra HD (4K) LED Smart Google TV',
      brand: 'SONY',
      modelNumber: 'KD-65X74K',
      category: 'TELEVISION',
      attributes: { screen_in: 65, resolution: '4k', colour: 'black' },
      priceMinor: 7599000,
    }),
  },
  {
    name: 'TV vs ITS OWN MOUNT',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'ACCESSORY_VS_DEVICE',
    note: 'cosine ~0.95, same brand, same model tokens. Only the accessory veto catches this.',
    a: amazon({
      title: 'Sony Bravia 139 cm (55 inches) 4K Ultra HD Smart LED Google TV KD-55X74K',
      brand: 'Sony',
      modelNumber: 'KD-55X74K',
      category: 'TELEVISION',
      attributes: { screen_in: 55, colour: 'black' },
      priceMinor: 5799000,
    }),
    b: flipkart({
      title: 'Wall Mount Bracket for Sony Bravia 55 inch TV',
      brand: 'Sony',
      category: 'OTHER',
      attributes: { colour: 'black' },
      priceMinor: 149000,
    }),
  },
  {
    name: 'remote vs tv',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'ACCESSORY_VS_DEVICE',
    a: amazon({
      title: 'Remote Control for Samsung Smart TV QA55Q60B',
      brand: 'Samsung',
      category: 'OTHER',
      attributes: {},
      priceMinor: 99900,
    }),
    b: flipkart({
      title: 'SAMSUNG 138 cm (55 inch) QLED Ultra HD (4K) Smart Tizen TV',
      brand: 'SAMSUNG',
      modelNumber: 'QA55Q60B',
      category: 'TELEVISION',
      attributes: { screen_in: 55 },
      priceMinor: 12899900,
    }),
  },
  {
    name: 'renewed vs new',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'CONDITION_MISMATCH',
    note: 'identical model and capacity; only the condition marker differs',
    a: amazon({
      title: '(Renewed) Sony Bravia 139 cm (55 inches) 4K Ultra HD TV',
      brand: 'Sony',
      modelNumber: 'KD-55X74K',
      category: 'TELEVISION',
      attributes: { screen_in: 55 },
      priceMinor: 3999000,
    }),
    b: flipkart({
      title: 'SONY Bravia 139 cm (55 inch) Ultra HD (4K) LED Smart TV',
      brand: 'SONY',
      modelNumber: 'KD-55X74K',
      category: 'TELEVISION',
      attributes: { screen_in: 55 },
      priceMinor: 5799000,
    }),
  },
  {
    name: 'different brands, near-identical descriptive titles',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'BRAND_MISMATCH',
    a: amazon({
      title: 'Realme Buds Air 5 Pro True Wireless Earbuds Black',
      brand: 'Realme',
      category: 'AUDIO',
      attributes: { colour: 'black' },
      priceMinor: 399900,
    }),
    b: flipkart({
      title: 'OPPO Buds Air 5 Pro True Wireless Earbuds Black',
      brand: 'OPPO',
      category: 'AUDIO',
      attributes: { colour: 'black' },
      priceMinor: 419900,
    }),
  },
  {
    name: 'conflicting valid EANs on otherwise identical listings',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'IDENTIFIER_CONFLICT',
    note: 'two valid, different barcodes are conclusive whatever the titles say',
    a: amazon({
      title: 'Samsung 55 inch QLED TV Titanium Grey',
      brand: 'Samsung',
      modelNumber: 'QA55Q60B',
      ean: '8806095299174',
      category: 'TELEVISION',
      attributes: { screen_in: 55 },
      priceMinor: 12999900,
    }),
    b: flipkart({
      title: 'SAMSUNG 55 inch QLED TV Titanium Grey',
      brand: 'SAMSUNG',
      modelNumber: 'QA55Q60B',
      ean: '8806095299181',
      category: 'TELEVISION',
      attributes: { screen_in: 55 },
      priceMinor: 12899900,
    }),
  },
  {
    name: 'fridges: 260 L vs 265 L, same brand and rating',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'ATTRIBUTE_MISMATCH',
    note: 'different SKUs at different prices; 1 L tolerance must not absorb a 5 L gap',
    a: amazon({
      title: 'LG 260 L 3 Star Frost Free Double Door Refrigerator',
      brand: 'LG',
      category: 'REFRIGERATOR',
      attributes: { capacity_l: 260, star_rating: 3 },
      priceMinor: 2899000,
    }),
    b: flipkart({
      title: 'LG 265 L 3 Star Frost Free Double Door Refrigerator',
      brand: 'LG',
      category: 'REFRIGERATOR',
      attributes: { capacity_l: 265, star_rating: 3 },
      priceMinor: 3099000,
    }),
  },
  {
    name: 'fridges: same capacity, 3 star vs 5 star',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'ATTRIBUTE_MISMATCH',
    a: amazon({
      title: 'LG 260 L 3 Star Frost Free Refrigerator',
      brand: 'LG',
      category: 'REFRIGERATOR',
      attributes: { capacity_l: 260, star_rating: 3 },
      priceMinor: 2899000,
    }),
    b: flipkart({
      title: 'LG 260 L 5 Star Frost Free Refrigerator',
      brand: 'LG',
      category: 'REFRIGERATOR',
      attributes: { capacity_l: 260, star_rating: 5 },
      priceMinor: 3499000,
    }),
  },
  {
    name: 'different categories entirely',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'CATEGORY_MISMATCH',
    a: amazon({
      title: 'LG 260 L Refrigerator',
      brand: 'LG',
      category: 'REFRIGERATOR',
      attributes: { capacity_l: 260 },
    }),
    b: flipkart({
      title: 'LG Washing Machine 7 kg',
      brand: 'LG',
      category: 'WASHING_MACHINE',
      attributes: { capacity_kg: 7 },
    }),
  },
  {
    name: 'AC: 1 Ton vs 1.5 Ton',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'ATTRIBUTE_MISMATCH',
    a: amazon({
      title: 'Voltas 1 Ton 3 Star Split AC',
      brand: 'Voltas',
      category: 'AIR_CONDITIONER',
      attributes: { capacity_ton: 1, star_rating: 3 },
      priceMinor: 2799000,
    }),
    b: flipkart({
      title: 'Voltas 1.5 Ton 3 Star Split AC',
      brand: 'Voltas',
      category: 'AIR_CONDITIONER',
      attributes: { capacity_ton: 1.5, star_rating: 3 },
      priceMinor: 3399000,
    }),
  },
  {
    name: 'unrelated products, no shared signal',
    sameProduct: false,
    expectDecision: 'REJECTED',
    a: amazon({
      title: 'boAt Airdopes 141 Bluetooth Earbuds',
      brand: 'boAt',
      category: 'AUDIO',
      attributes: { colour: 'white' },
      priceMinor: 129900,
    }),
    b: flipkart({
      title: 'JBL Tune 510BT Wireless Headphones',
      brand: 'JBL',
      category: 'AUDIO',
      attributes: { colour: 'blue' },
      priceMinor: 329900,
    }),
  },
];
