import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { RequestContextStore } from '../../common/context/request-context';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AuthService, type AuthenticatedUser } from './auth.service';
import { IS_PUBLIC_KEY } from './decorators';

/**
 * Global authentication guard.
 *
 * Registered first among the global guards, because everything downstream
 * depends on it having run: RolesGuard needs `request.user`, and RateLimitGuard
 * reads `userId` from the request context to give authenticated callers their
 * own bucket instead of sharing one keyed by IP.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    const token = extractBearerToken(request);
    if (!token) {
      throw new AppError(
        ErrorCode.UNAUTHENTICATED,
        'Authentication required',
        401,
      );
    }

    const user = await this.authService.authenticate(token);

    request.user = user;

    // Put the id on the ambient context too, so log lines and the rate-limit
    // key pick it up without threading the request object through every layer.
    RequestContextStore.setUserId(user.id);

    return true;
  }
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;

  // Split on the first space only, and require the exact scheme. Accepting a
  // bare token, or matching the scheme case-insensitively against a prefix,
  // both widen what counts as a credential for no benefit.
  const [scheme, ...rest] = header.split(' ');
  if (scheme !== 'Bearer') return undefined;

  const token = rest.join(' ').trim();
  return token.length > 0 ? token : undefined;
}
