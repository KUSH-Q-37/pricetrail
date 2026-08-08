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
  category: 'PHONE',
  attributes: {},
  ...over,
});

const flipkart = (over: Partial<MatchInput>): MatchInput => ({
  platform: 'FLIPKART',
  externalId: 'MOBDEFAULT0001',
  title: '',
  category: 'PHONE',
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
    name: 'identical phone, shared EAN',
    sameProduct: true,
    expectDecision: 'AUTO_CONFIRMED',
    a: amazon({
      title: 'Apple iPhone 15 Pro (256 GB) - Natural Titanium',
      brand: 'Apple',
      modelNumber: 'A3102',
      ean: '0195949022029',
      attributes: { storage_gb: 256, ram_gb: 8, colour: 'natural titanium' },
      priceMinor: 13499900,
    }),
    b: flipkart({
      title: 'APPLE iPhone 15 Pro (Natural Titanium, 256 GB)',
      brand: 'APPLE',
      modelNumber: 'A3102',
      ean: '0195949022029',
      attributes: { storage_gb: 256, ram_gb: 8, colour: 'natural titanium' },
      priceMinor: 13290000,
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
      title: 'Samsung Galaxy S24 Ultra 5G (512 GB) Titanium Grey',
      brand: 'Samsung',
      modelNumber: 'SM-S928B',
      attributes: { storage_gb: 512, ram_gb: 12, colour: 'titanium grey' },
      priceMinor: 12999900,
    }),
    b: flipkart({
      title: 'SAMSUNG Galaxy S24 Ultra 5G (Titanium Gray, 512 GB)',
      brand: 'SAMSUNG',
      modelNumber: 'SM-S928B',
      attributes: { storage_gb: 512, ram_gb: 12, colour: 'gray' },
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
    name: 'sub-brand: listing says Redmi, other says Xiaomi',
    sameProduct: true,
    note: 'Xiaomi/Redmi/Poco are one family; treating them as different brands would veto real pairs',
    a: amazon({
      title: 'Redmi Note 13 Pro 5G (8 GB, 256 GB) Midnight Black',
      brand: 'Redmi',
      modelNumber: '2312DRA50G',
      attributes: { storage_gb: 256, ram_gb: 8, colour: 'midnight black' },
      priceMinor: 2499900,
    }),
    b: flipkart({
      title: 'XIAOMI Redmi Note 13 Pro 5G (Midnight Black, 256 GB)',
      brand: 'Xiaomi',
      modelNumber: '2312DRA50G',
      attributes: { storage_gb: 256, ram_gb: 8, colour: 'midnight black' },
      priceMinor: 2549900,
    }),
  },
  {
    name: 'genuine match with NO identifiers published anywhere',
    sameProduct: true,
    expectDecision: 'NEEDS_REVIEW',
    note: 'must not auto-confirm on titles alone, and must not be rejected for lacking data',
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
    name: 'THE CLASSIC: same phone, 128 GB vs 256 GB',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'ATTRIBUTE_MISMATCH',
    note: 'shares brand, model, ~95% of title. Pure similarity scores this ~0.93 and auto-confirms.',
    a: amazon({
      title: 'Apple iPhone 15 Pro (128 GB) - Natural Titanium',
      brand: 'Apple',
      modelNumber: 'A3102',
      attributes: { storage_gb: 128, ram_gb: 8, colour: 'natural titanium' },
      priceMinor: 11999900,
    }),
    b: flipkart({
      title: 'APPLE iPhone 15 Pro (Natural Titanium, 256 GB)',
      brand: 'APPLE',
      modelNumber: 'A3102',
      attributes: { storage_gb: 256, ram_gb: 8, colour: 'natural titanium' },
      priceMinor: 13290000,
    }),
  },
  {
    name: 'same phone, 8 GB vs 12 GB RAM',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'ATTRIBUTE_MISMATCH',
    a: amazon({
      title: 'OnePlus 12R 5G (8 GB, 128 GB) Cool Blue',
      brand: 'OnePlus',
      modelNumber: 'CPH2585',
      attributes: { storage_gb: 128, ram_gb: 8, colour: 'cool blue' },
      priceMinor: 3999900,
    }),
    b: flipkart({
      title: 'OnePlus 12R 5G (Cool Blue, 128 GB)',
      brand: 'OnePlus',
      modelNumber: 'CPH2585',
      attributes: { storage_gb: 128, ram_gb: 12, colour: 'cool blue' },
      priceMinor: 4299900,
    }),
  },
  {
    name: 'PHONE vs ITS OWN CASE',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'ACCESSORY_VS_DEVICE',
    note: 'cosine ~0.95, same brand, same model tokens. Only the accessory veto catches this.',
    a: amazon({
      title: 'Apple iPhone 15 Pro (256 GB) - Natural Titanium',
      brand: 'Apple',
      modelNumber: 'A3102',
      attributes: { storage_gb: 256, colour: 'natural titanium' },
      priceMinor: 13499900,
    }),
    b: flipkart({
      title: 'Apple Silicone Case with MagSafe for iPhone 15 Pro',
      brand: 'Apple',
      attributes: { colour: 'natural titanium' },
      priceMinor: 490000,
    }),
  },
  {
    name: 'screen protector vs phone',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'ACCESSORY_VS_DEVICE',
    a: amazon({
      title: 'Tempered Glass Screen Guard for Samsung Galaxy S24 Ultra',
      brand: 'Samsung',
      attributes: {},
      priceMinor: 29900,
    }),
    b: flipkart({
      title: 'SAMSUNG Galaxy S24 Ultra 5G (Titanium Grey, 512 GB)',
      brand: 'SAMSUNG',
      modelNumber: 'SM-S928B',
      attributes: { storage_gb: 512 },
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
      title: '(Renewed) Apple iPhone 15 Pro (256 GB) Natural Titanium',
      brand: 'Apple',
      modelNumber: 'A3102',
      attributes: { storage_gb: 256, ram_gb: 8 },
      priceMinor: 9999900,
    }),
    b: flipkart({
      title: 'APPLE iPhone 15 Pro (Natural Titanium, 256 GB)',
      brand: 'APPLE',
      modelNumber: 'A3102',
      attributes: { storage_gb: 256, ram_gb: 8 },
      priceMinor: 13290000,
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
      title: 'Samsung Galaxy S24 Ultra 5G Titanium Grey',
      brand: 'Samsung',
      modelNumber: 'SM-S928B',
      ean: '8806095299174',
      attributes: { storage_gb: 512 },
      priceMinor: 12999900,
    }),
    b: flipkart({
      title: 'SAMSUNG Galaxy S24 Ultra 5G Titanium Grey',
      brand: 'SAMSUNG',
      modelNumber: 'SM-S928B',
      ean: '8806095299181',
      attributes: { storage_gb: 512 },
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
    name: 'laptops: same model, 13-inch vs 15-inch',
    sameProduct: false,
    expectDecision: 'REJECTED',
    expectVeto: 'ATTRIBUTE_MISMATCH',
    note: 'screen size vetoes on laptops (defines the SKU) but not on phones',
    a: amazon({
      title: 'Apple MacBook Air M3 13-inch 8GB 256GB Midnight',
      brand: 'Apple',
      category: 'LAPTOP',
      attributes: { screen_in: 13.6, ram_gb: 8, storage_gb: 256 },
      priceMinor: 10499900,
    }),
    b: flipkart({
      title: 'APPLE MacBook Air M3 15-inch (8 GB, 256 GB) Midnight',
      brand: 'APPLE',
      category: 'LAPTOP',
      attributes: { screen_in: 15.3, ram_gb: 8, storage_gb: 256 },
      priceMinor: 12999900,
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
