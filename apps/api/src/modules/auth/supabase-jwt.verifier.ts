import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { AppConfigService } from '../../config/app-config.service';
import type { TokenVerifier, VerifiedTokenClaims } from './token-verifier';

/**
 * Verifies Supabase access tokens against the project's published JWKS.
 *
 * `createRemoteJWKSet` is created once and reused: it caches the key set in
 * memory and only refetches on an unknown `kid` (with its own cooldown so a
 * flood of bogus tokens cannot be turned into a request amplifier against
 * Supabase). Constructing it per request would mean an HTTPS round trip on
 * every authenticated call.
 */
@Injectable()
export class SupabaseJwtVerifier implements TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  constructor(config: AppConfigService) {
    this.issuer = config.supabaseIssuer;
    this.jwks = createRemoteJWKSet(new URL(config.supabaseJwksUrl), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
  }

  async verify(token: string): Promise<VerifiedTokenClaims> {
    // issuer and audience are checked by jose itself. Without them a valid
    // token from *any* Supabase project would authenticate here.
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: 'authenticated',
    });

    return toClaims(payload);
  }
}

export function toClaims(payload: JWTPayload): VerifiedTokenClaims {
  const subject = payload.sub;
  const email = typeof payload['email'] === 'string' ? payload['email'] : undefined;

  if (!subject) {
    throw new Error('Token is missing the `sub` claim');
  }
  if (!email) {
    throw new Error('Token is missing the `email` claim');
  }
  if (!payload.exp) {
    throw new Error('Token is missing the `exp` claim');
  }

  return { subject, email, expiresAt: payload.exp };
}
