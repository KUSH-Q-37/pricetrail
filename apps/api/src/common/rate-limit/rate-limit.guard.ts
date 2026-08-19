import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../infra/redis/redis.service';
import { RateLimitedError } from '../errors/app-error';
import {
  RATE_LIMIT_KEY,
  SKIP_RATE_LIMIT_KEY,
  type RateLimitOptions,
} from './rate-limit.decorator';

/**
 * Atomic fixed-window counter.
 *
 * INCR and EXPIRE must be one operation. Issued separately, a process that
 * dies between them leaves a key with no TTL — that client is then locked out
 * permanently, because the counter never resets. A Lua script runs
 * server-side as a single atomic unit and removes the window entirely.
 */
const INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return { current, redis.call('TTL', KEYS[1]) }
`;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(RateLimitGuard.name)
    private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const options =
      this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? this.config.rateLimit;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const key = this.buildKey(request, context);

    let count: number;
    let ttl: number;

    try {
      const [rawCount, rawTtl] = (await this.redis.client.eval(
        INCREMENT_SCRIPT,
        1,
        key,
        String(options.windowSeconds),
      )) as [number, number];

      count = rawCount;
      ttl = rawTtl;
    } catch (error) {
      // Fail OPEN. Rate limiting is a protective measure, not a correctness
      // one — a Redis outage should degrade protection, not take the whole API
      // down with it. Logged at error so the outage is still loud.
      this.logger.error({ err: error }, 'Rate limit check failed; allowing request');
      return true;
    }

    const remaining = Math.max(0, options.maxRequests - count);
    const resetSeconds = ttl >= 0 ? ttl : options.windowSeconds;

    // Draft IETF RateLimit header fields — clients can self-throttle instead
    // of discovering the limit by being rejected.
    response.setHeader('RateLimit-Limit', options.maxRequests);
    response.setHeader('RateLimit-Remaining', remaining);
    response.setHeader('RateLimit-Reset', resetSeconds);

    if (count > options.maxRequests) {
      response.setHeader('Retry-After', resetSeconds);
      throw new RateLimitedError(resetSeconds);
    }

    return true;
  }

  /**
   * Bucket per IP per route.
   *
   * There is no sign-in, so IP is the only identity available. It previously
   * keyed by user id where one existed, and that branch is gone rather than
   * left dead — it could never fire again, and reading it would suggest a
   * fairness property this no longer has.
   *
   * Two consequences follow, and both matter more than they used to:
   *
   *  - `trust proxy` MUST be correct. Set wrongly, every request appears to
   *    come from the load balancer and the whole internet shares one bucket.
   *  - Everyone behind one NAT — an office, a mobile carrier — now shares a
   *    bucket with no way to distinguish themselves by signing in.
   */
  private buildKey(request: Request, context: ExecutionContext): string {
    const identity = `ip:${request.ip ?? 'unknown'}`;
    const route = `${request.method}:${context.getClass().name}.${context.getHandler().name}`;
    return `ratelimit:${identity}:${route}`;
  }
}
