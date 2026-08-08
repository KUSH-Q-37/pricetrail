/**
 * Flipkart DOM selectors — FALLBACK ONLY. Expect these to rot.
 *
 * Flipkart ships build-generated class names (`_30jeq3`, `B_NuCI`, `Nx9bqj`)
 * that change whenever they redeploy their frontend, with no notice and no
 * stability guarantee. Anything built primarily on these selectors breaks
 * every few weeks.
 *
 * That is why the parser reads embedded JSON-LD first (see
 * flipkart.parser.ts). schema.org Product markup is emitted for SEO, so
 * Flipkart has a strong commercial incentive to keep it stable and correctly
 * shaped — Google reads it too. These selectors exist only to fill the gaps
 * JSON-LD does not cover (MRP, discount badge, specification table) and to
 * serve as a last resort when the JSON-LD block is missing.
 *
 * Multiple candidates per field, newest first. Each entry is a class hash
 * observed in the wild; when one stops matching, add the replacement to the
 * front of the list rather than editing in place — the old markup often
 * survives on a subset of pages during a rollout.
 */
export const FLIPKART_SELECTORS = {
  title: ['span.VU-ZEz', 'span.B_NuCI', 'h1 span', 'h1'],

  price: ['div.Nx9bqj.CxhGGd', 'div._30jeq3._16Jk6d', 'div._30jeq3', '[class*="Nx9bqj"]'],

  /** Struck-through list price. */
  mrp: ['div.yRaY8j', 'div._3I9_wc._2p6lqe', 'div._3I9_wc', '[class*="yRaY8j"]'],

  /**
   * Attribute-based price selector — preferred over every class above.
   *
   * As of the current build Flipkart tags typographic scale with a `font`
   * attribute (`default-fk-font-l` for the price block). That is markedly more
   * stable than the class hashes, which changed wholesale between the markup
   * this file was first written against and today — every selector above now
   * misses.
   *
   * Selling price and MRP are SIBLINGS WITH IDENTICAL CLASSES, distinguishable
   * only by document order: the first rupee value in this block is the price,
   * the second is the struck-through MRP. Ordinal selection is not elegant,
   * but the alternative is no MRP at all, and the parser cross-checks the
   * result (MRP must exceed price) before accepting it.
   */
  priceBlock: ['[font="default-fk-font-l"]', '[font="default-fk-font-m"]'],

  discount: ['div.UkUFwK span', 'div._3Ay6Sb span', 'div._3Ay6Sb', '[class*="UkUFwK"]'],

  availability: ['div._16FRp0', 'div.Z8JjpR', '[class*="_16FRp0"]'],

  seller: ['div#sellerName span span', 'div._1RLviY', '[id="sellerName"] span'],

  rating: ['div.XQDdHH', 'div._3LWZlK', '[class*="XQDdHH"]'],

  reviewCount: ['span.Wphh3N', 'span._2_R_DZ', '[class*="Wphh3N"]'],

  image: ['img.DByuf4', 'img._396cs4', 'img[class*="DByuf4"]'],

  /** Specification rows: label cell + value cell. */
  specRows: ['div._1OjC5I tr', 'table._14cfVK tr', 'div.GNDEQ- tr'],
  specLabel: ['td._1hKmbr', 'td.col-3-9', 'th'],
  specValue: ['td.URwL2w li', 'td.col-9-12 li', 'td li', 'td'],

  /** Highlight bullets, often carrying RAM/storage/capacity. */
  highlights: ['div._2418kt li', 'div.xFVion li', 'ul._1xgFaf li'],

  /**
   * Bot-check markers. Flipkart fronts with PerimeterX, which serves a
   * challenge page carrying a 200 status — so status code alone cannot
   * detect it.
   */
  captchaMarkers: [
    '#px-captcha',
    '[id^="px-captcha"]',
    'div._3xFrJs',
    'script[src*="perimeterx"]',
    'script[src*="/px/"]',
  ],
} as const;
