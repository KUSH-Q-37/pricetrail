import { Inject, Injectable } from '@nestjs/common';
import type { UserRole } from '@pricetrail/database';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { AppError, ErrorCode } from '../../common/errors/app-error';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TOKEN_VERIFIER, type TokenVerifier } from './token-verifier';

/** The authenticated principal attached to a request. */
export interface AuthenticatedUser {
  /** Our internal users.id — the FK every other table references. */
  id: string;
  /** Supabase auth.users.id. */
  supabaseUserId: string;
  email: string;
  role: UserRole;
  trackingQuota: number;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AuthService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Verify a bearer token and resolve it to a local user.
   *
   * Failures are collapsed into a single UNAUTHENTICATED response on purpose.
   * Distinguishing "expired" from "bad signature" from "unknown key" in the
   * response body tells an attacker which of their guesses was closest; the
   * detail goes to the log, where it is useful and not adversary-readable.
   */
  async authenticate(token: string): Promise<AuthenticatedUser> {
    let subject: string;
    let email: string;

    try {
      const claims = await this.verifier.verify(token);
      subject = claims.subject;
      email = claims.email;
    } catch (error) {
      this.logger.debug(
        { err: error },
        'Token verification failed',
      );
      throw new AppError(
        ErrorCode.UNAUTHENTICATED,
        'Invalid or expired session',
        401,
      );
    }

    return this.provision(subject, email);
  }

  /**
   * Just-in-time provisioning.
   *
   * Supabase owns identity; this table owns application state (plan, quota,
   * role). Rather than depending on a webhook from Supabase to create the row
   * — which can be missed, replayed, or arrive out of order — the row is
   * created on first authenticated request. The token has already been
   * cryptographically verified at this point, so the identity is trustworthy.
   *
   * `upsert` keyed on supabaseUserId is idempotent under concurrency: two
   * simultaneous first requests race into the same unique index and one loses
   * harmlessly.
   *
   * NOTE: `role` is deliberately absent from the update branch. An existing
   * user's role must never be reset by a login — it is changed only by an
   * administrator.
   */
  private async provision(
    supabaseUserId: string,
    email: string,
  ): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.upsert({
      where: { supabaseUserId },
      update: { email },
      create: { supabaseUserId, email },
      select: {
        id: true,
        supabaseUserId: true,
        email: true,
        role: true,
        trackingQuota: true,
        deletedAt: true,
      },
    });

    if (user.deletedAt) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'This account has been deactivated',
        403,
      );
    }

    return {
      id: user.id,
      supabaseUserId: user.supabaseUserId,
      email: user.email,
      role: user.role,
      trackingQuota: user.trackingQuota,
    };
  }
}
