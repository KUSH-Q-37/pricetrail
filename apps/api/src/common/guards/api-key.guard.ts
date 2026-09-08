import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppConfigService } from '../../config/app-config.service';
import { AppError, ErrorCode } from '../errors/app-error';
import { SKIP_RATE_LIMIT_KEY } from '../rate-limit/rate-limit.decorator';

/**
 * Rejects requests that do not carry a valid `x-api-key` header.
 *
 * When API_SECRET_KEY is empty (the default), the guard is a no-op — every
 * request passes. This keeps local development frictionless while locking down
 * production with a single env var.
 *
 * Health probes are always exempt: an orchestrator must be able to reach them
 * without credentials, and they disclose nothing sensitive.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly config: AppConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.apiSecretKey;

    // No key configured → open access (local dev).
    if (!secret) return true;

    // Health probes and any route decorated with @SkipRateLimit() are exempt.
    // Reusing the same decorator avoids inventing a second "skip" mechanism
    // for the same set of routes.
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-api-key'];

    if (provided === secret) return true;

    throw new AppError(
      ErrorCode.UNAUTHENTICATED,
      'Missing or invalid API key',
      401,
    );
  }
}
