/**
 * Raised when a marketplace serves a bot-check page instead of the product.
 *
 * Shared by both platform parsers. Detecting this BEFORE parsing matters: a
 * challenge page still has a <title> and would otherwise parse into a
 * "product" called "Robot Check" with no price — which the boundary schema
 * would reject, but with a misleading reason that sends you hunting for a
 * broken selector instead of rotating a proxy.
 */
export class BotChallengeError extends Error {
  readonly platform: string;

  constructor(platform: string) {
    super(`${platform} returned a bot-check page instead of the product`);
    this.name = 'BotChallengeError';
    this.platform = platform;
  }
}
