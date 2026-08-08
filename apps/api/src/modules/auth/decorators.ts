import {
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { UserRole } from '@pricetrail/database';
import type { Request } from 'express';

import type { AuthenticatedUser } from './auth.service';

export const IS_PUBLIC_KEY = 'pricetrail:public';
export const ROLES_KEY = 'pricetrail:roles';

/**
 * Exempt a route from authentication.
 *
 * Authentication is global by default and opted *out* of here, rather than
 * opted into with a guard per controller. The failure modes are not symmetric:
 * forgetting to opt out yields a 401 on a public endpoint, which is noticed
 * immediately. Forgetting to opt *in* yields an unauthenticated private
 * endpoint, which is noticed by whoever finds it first.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restrict a route to the listed application roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Inject the authenticated principal.
 *
 * `@CurrentUser() user: AuthenticatedUser` — or `@CurrentUser('id') id: string`
 * for a single field.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    const user = request.user;
    if (!user) return undefined;

    return field ? user[field] : user;
  },
);
