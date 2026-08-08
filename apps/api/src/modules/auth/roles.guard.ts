import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@pricetrail/database';
import type { Request } from 'express';

import { AppError, ErrorCode } from '../../common/errors/app-error';
import type { AuthenticatedUser } from './auth.service';
import { ROLES_KEY } from './decorators';

/**
 * Application-role authorization, for routes marked with `@Roles(...)`.
 *
 * The role is read from `request.user`, which JwtAuthGuard populated from our
 * own database — never from a token claim. Supabase `user_metadata` is
 * writable by the account holder through the public client SDK, so a role
 * carried in the JWT would be self-assignable.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    const user = request.user;

    // Reachable only if a route is marked @Public() and @Roles() together,
    // which is a contradiction worth failing closed on.
    if (!user) {
      throw new AppError(
        ErrorCode.UNAUTHENTICATED,
        'Authentication required',
        401,
      );
    }

    if (!required.includes(user.role)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'You do not have permission to perform this action',
        403,
      );
    }

    return true;
  }
}
