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

  /** See env.schema.ts — single-service deployments host the workers here. */
  get runWorkersInApi(): boolean {
    return this.get('RUN_WORKERS_IN_API');
  }

  get apiScrapeConcurrency(): number {
    return this.get('API_SCRAPE_CONCURRENCY');
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


  get rateLimit(): { windowSeconds: number; maxRequests: number } {
    return {
      windowSeconds: this.get('RATE_LIMIT_WINDOW_SECONDS'),
      maxRequests: this.get('RATE_LIMIT_MAX_REQUESTS'),
    };
  }
}
