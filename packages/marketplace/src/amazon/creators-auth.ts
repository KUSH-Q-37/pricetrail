/**
 * OAuth 2.0 client-credentials token client for the Amazon Creators API.
 *
 * This replaces paapi-signer.ts, which implemented AWS Signature Version 4.
 * Amazon retired the Product Advertising API on 15 May 2026 and closed it to
 * new customers; the Creators API is its replacement and authenticates with a
 * bearer token instead of a per-request signature.
 *
 * The practical difference is that a signature is computed for every request
 * from keys held in memory, whereas a token is fetched once and reused until
 * it expires. That makes caching this correctly worth more than it looks: the
 * token endpoint is rate-limited separately from the catalogue, and a client
 * that re-authenticates on every call will exhaust it during a daily sweep
 * long before the catalogue quota is touched.
 */

/**
 * Which regional endpoint issues tokens for a credential.
 *
 * The version is stamped on the credential when Amazon generates it and is
 * not a free choice — a v3.2 credential authenticates against the EU endpoint
 * and nowhere else.
 *
 * INDIA IS EU, NOT FAR EAST. Amazon groups amazon.in with the European
 * marketplaces (alongside UK, DE, FR, AE, SA and others), and Far East covers
 * only JP, SG and AU. It reads like a mistake and is not one; getting it wrong
 * produces an invalid_client error that looks like bad credentials.
 */
export const CREATORS_TOKEN_ENDPOINT = {
  /** NA — US, CA, MX, BR */
  'v3.1': 'https://api.amazon.com/auth/o2/token',
  /** EU — UK, DE, FR, IT, ES, NL, BE, EG, IN, IE, PL, SA, SE, TR, AE */
  'v3.2': 'https://api.amazon.co.uk/auth/o2/token',
  /** FE — JP, SG, AU */
  'v3.3': 'https://api.amazon.co.jp/auth/o2/token',
} as const;

export type CreatorsVersion = keyof typeof CREATORS_TOKEN_ENDPOINT;

export interface CreatorsCredentials {
  /** `amzn1.application-oa2-client.…` from Associates Central. */
  clientId: string;
  /** `amzn1.oa2-cs.v1.…`. Shown once at creation. */
  clientSecret: string;
  /** Stamped on the credential. amazon.in credentials are v3.2. */
  version: CreatorsVersion;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Seconds of headroom before a token is treated as expired.
 *
 * A token that expires mid-flight fails the request it was attached to. Sixty
 * seconds is longer than any single catalogue call and short enough that it
 * costs at most one extra refresh per hour.
 */
const EXPIRY_MARGIN_SECONDS = 60;

export class CreatorsTokenProvider {
  private token: string | undefined;
  private expiresAt = 0;

  /**
   * In-flight refresh, shared by every caller.
   *
   * Without this, a sweep firing several requests at once on a cold cache
   * sends that many identical token requests — each valid, each counting
   * against the auth quota, and all but one discarded.
   */
  private pending: Promise<string> | undefined;

  constructor(
    private readonly credentials: CreatorsCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** A valid bearer token, fetched or reused. */
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    if (this.pending) return this.pending;

    this.pending = this.fetchToken().finally(() => {
      this.pending = undefined;
    });

    return this.pending;
  }

  /** Drop the cached token. Call after a 401 so the next attempt re-authenticates. */
  invalidate(): void {
    this.token = undefined;
    this.expiresAt = 0;
  }

  private async fetchToken(): Promise<string> {
    const endpoint = CREATORS_TOKEN_ENDPOINT[this.credentials.version];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // JSON, not the form encoding most OAuth servers expect. Amazon's
        // documented example posts a JSON body, and a form-encoded one is
        // rejected.
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          scope: 'creatorsapi::default',
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // The body carries Amazon's own reason — `invalid_client` for a wrong
      // id/secret, and equally for a credential whose version does not match
      // the endpoint it was sent to. Surfaced verbatim, because those two
      // causes are indistinguishable from the status code alone.
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Creators API token request failed (HTTP ${response.status}): ${detail.slice(0, 200)}`,
      );
    }

    const body = (await response.json()) as TokenResponse;
    if (!body.access_token) {
      throw new Error('Creators API token response contained no access_token');
    }

    this.token = body.access_token;
    this.expiresAt =
      Date.now() + Math.max(0, (body.expires_in ?? 3600) - EXPIRY_MARGIN_SECONDS) * 1000;

    return this.token;
  }
}
