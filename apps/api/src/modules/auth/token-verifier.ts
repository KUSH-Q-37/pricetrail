/**
 * Claims we rely on from a verified access token.
 *
 * Note what is absent: the application role. Supabase exposes `user_metadata`,
 * which is writable by the user themselves via the client SDK — trusting a role
 * from there would let any account promote itself to admin. Application roles
 * are read from our own `users` table and nowhere else.
 */
export interface VerifiedTokenClaims {
  /** Supabase user id (`sub`). Stable for the lifetime of the account. */
  subject: string;
  email: string;
  /** Seconds since epoch. */
  expiresAt: number;
}

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export interface TokenVerifier {
  /**
   * Resolve a bearer token to its claims.
   * Implementations MUST throw on any failure — expiry, bad signature, wrong
   * issuer or audience — and must never return partially trusted claims.
   */
  verify(token: string): Promise<VerifiedTokenClaims>;
}
