import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

import { AppConfigService } from '../../config/app-config.service';
import { toClaims } from './supabase-jwt.verifier';
import type { TokenVerifier, VerifiedTokenClaims } from './token-verifier';

const LOCAL_ISSUER = 'pricetrail-local-dev';

/**
 * Symmetric HS256 verifier used only when AUTH_MODE="local-dev".
 *
 * This exists so the entire authentication path — guards, JIT user
 * provisioning, role checks, per-user rate-limit keys, the frontend session
 * flow — is exercisable before a Supabase project exists. It deliberately
 * mints tokens as well as verifying them, which is precisely why the env
 * schema refuses to start the process if NODE_ENV=production.
 *
 * The issuer differs from Supabase's, so a token minted here can never be
 * accepted by the Supabase verifier, and vice versa. Swapping AUTH_MODE
 * invalidates every outstanding token by construction rather than by policy.
 */
@Injectable()
export class LocalDevVerifier implements TokenVerifier {
  private readonly secret: Uint8Array;
  private readonly ttlSeconds: number;

  constructor(config: AppConfigService) {
    this.secret = new TextEncoder().encode(config.localDevAuthSecret);
    this.ttlSeconds = config.localDevTokenTtlSeconds;
  }

  async verify(token: string): Promise<VerifiedTokenClaims> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: LOCAL_ISSUER,
      audience: 'authenticated',
    });

    return toClaims(payload);
  }

  /** Mint a development token. Reachable only via the dev-only endpoint. */
  async mint(subject: string, email: string): Promise<{ accessToken: string; expiresIn: number }> {
    const accessToken = await new SignJWT({ email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(subject)
      .setIssuer(LOCAL_ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.secret);

    return { accessToken, expiresIn: this.ttlSeconds };
  }
}
