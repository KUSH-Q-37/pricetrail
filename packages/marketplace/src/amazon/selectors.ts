/**
 * Amazon DOM selectors — THE FILE THAT BREAKS.
 *
 * Every selector Amazon can change lives here and nowhere else. When a fetch
 * starts failing, this is the only file to open, and a fix is a one-line edit
 * rather than a hunt through parsing logic.
 *
 * Each field lists several candidates in priority order because Amazon serves
 * materially different markup per category, per A/B bucket, and per device.
 * The parser tries each in turn and takes the first that yields a usable
 * value, so a layout change degrades one field instead of failing the page.
 */
export const AMAZON_SELECTORS = {
  title: ['#productTitle', '#title span', 'h1.a-size-large span'],

  /**
   * Price. `.a-offscreen` is listed first deliberately: it holds the complete,
   * screen-reader-friendly value ("₹1,29,999.00") as a single text node,
   * whereas the visible price is split across `.a-price-whole` and
   * `.a-price-fraction` and concatenating those yields "1,29,999" + "00" =
   * "1,29,99900" if joined naively.
   */
  price: [
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
    '#corePrice_feature_div .a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.a-price .a-offscreen',
    '#price_inside_buybox',
  ],

  /** List price / MRP, struck through next to the selling price. */
  mrp: [
    '#corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen',
    '#corePrice_feature_div .a-text-price .a-offscreen',
    '.basisPrice .a-price .a-offscreen',
    '#listPrice',
    '#priceblock_listprice',
  ],

  discount: [
    '#corePriceDisplay_desktop_feature_div .savingsPercentage',
    '.savingsPercentage',
    '#dealBadge',
  ],

  availability: ['#availability span', '#availability', '#outOfStock', '#deliveryMessageMirId'],

  brand: ['#bylineInfo', '#brand', 'a#bylineInfo'],

  seller: ['#sellerProfileTriggerId', '#merchant-info a', '#tabular-buybox .tabular-buybox-text'],

  rating: ['#acrPopover', 'span[data-hook="rating-out-of-text"]', '#averageCustomerReviews .a-icon-alt'],

  reviewCount: ['#acrCustomerReviewText', 'span[data-hook="total-review-count"]'],

  image: ['#landingImage', '#imgBlkFront', '#main-image', '#ebooksImgBlkFront'],

  /**
   * Specifications appear in three different structures depending on category.
   * All three are read and merged; a phone uses the tech-spec table, an
   * appliance often uses the detail bullets, and books use the bullet list.
   */
  specTables: [
    '#productDetails_techSpec_section_1 tr',
    '#productDetails_detailBullets_sections1 tr',
    '#technicalSpecifications_section_1 tr',
    '.prodDetTable tr',
  ],
  detailBullets: ['#detailBullets_feature_div li', '#detail-bullets li'],

  /** Marks a page that exists but has no purchasable offer. */
  unavailableMarkers: ['#outOfStock', '#availability .a-color-price'],

  /**
   * Bot-check markers. Their presence means the response is a challenge page,
   * not a product page — parsing it would yield a "product" titled something
   * like "Robot Check" with no price.
   */
  captchaMarkers: [
    'form[action*="validateCaptcha"]',
    '#captchacharacters',
    'input[name="amzn-captcha-token"]',
  ],
} as const;

export type AmazonSelectorGroup = keyof typeof AMAZON_SELECTORS;
