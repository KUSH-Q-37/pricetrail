import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from './env.schema';

/**
 * Typed accessor over the validated environment.
 *
 * Injecting raw `ConfigService` everywhere loses the types the Zod schema
 * already proved — `config.get('PORT')` returns `unknown`. This wrapper gives
 * call sites real types and a single place to derive computed values (parsed
 * CORS list, isProduction, and so on).
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true }) as Env[K];
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get port(): number {
    return this.get('PORT');
  }

  get databaseUrl(): string {
    return this.get('DATABASE_URL');
  }

  get redisUrl(): string {
    return this.get('REDIS_URL');
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.get('LOG_LEVEL');
  }

  get appTimezone(): string {
    return this.get('APP_TIMEZONE');
  }

  get swaggerEnabled(): boolean {
    return this.get('SWAGGER_ENABLED');
  }

  /**
   * Parsed allowlist. An empty list means same-origin only — CORS stays off
   * rather than falling back to a wildcard.
   */
  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  get authMode(): Env['AUTH_MODE'] {
    return this.get('AUTH_MODE');
  }

  get isLocalDevAuth(): boolean {
    return this.authMode === 'local-dev';
  }

  /**
   * JWKS endpoint for the Supabase project.
   *
   * Supabase signs access tokens with an asymmetric key and publishes the
   * public half here. Verifying against JWKS rather than a shared HS256 secret
   * means the API never holds a key capable of *minting* tokens — only of
   * checking them. A leak of this service's config cannot forge a session.
   */
  get supabaseJwksUrl(): string {
    const base = this.get('SUPABASE_URL');
    if (!base) {
      throw new Error('SUPABASE_URL is not configured');
    }
    return `${base.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  }

  get supabaseIssuer(): string {
    const base = this.get('SUPABASE_URL');
    if (!base) {
      throw new Error('SUPABASE_URL is not configured');
    }
    return `${base.replace(/\/$/, '')}/auth/v1`;
  }

  get localDevAuthSecret(): string {
    const secret = this.get('LOCAL_DEV_AUTH_SECRET');
    if (!secret) {
      throw new Error('LOCAL_DEV_AUTH_SECRET is not configured');
    }
    return secret;
  }

  get localDevTokenTtlSeconds(): number {
    return this.get('LOCAL_DEV_TOKEN_TTL_SECONDS');
  }

  get rateLimit(): { windowSeconds: number; maxRequests: number } {
    return {
      windowSeconds: this.get('RATE_LIMIT_WINDOW_SECONDS'),
      maxRequests: this.get('RATE_LIMIT_MAX_REQUESTS'),
    };
  }
}
