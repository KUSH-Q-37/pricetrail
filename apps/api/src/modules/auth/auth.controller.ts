import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@pricetrail/database';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthService, type AuthenticatedUser } from './auth.service';
import { CurrentUser, Public, Roles } from './decorators';
import { LocalDevVerifier } from './local-dev.verifier';

const DevTokenSchema = z.object({
  email: z.string().min(3).max(320),
  role: z.enum(['USER', 'ADMIN']).default('USER'),
});
type DevTokenRequest = z.infer<typeof DevTokenSchema>;

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly localDev: LocalDevVerifier,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'The authenticated user' })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /**
   * Admin-only probe used to verify RolesGuard actually denies a normal user.
   * Replaced by the real review queue in Phase 9.
   */
  @Get('admin-check')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin-only endpoint (role check)' })
  adminCheck(@CurrentUser('email') email: string): { ok: true; email: string } {
    return { ok: true, email };
  }

  /**
   * Mint a development access token.
   *
   * Exists only while AUTH_MODE="local-dev", so the auth flow can be built and
   * tested before a Supabase project exists. Three independent things have to
   * be true for this to be reachable:
   *
   *   1. AUTH_MODE="local-dev" — and the env schema refuses to boot the process
   *      at all if that is combined with NODE_ENV="production"
   *   2. this handler re-checks the mode at request time and 404s otherwise
   *   3. LOCAL_DEV_AUTH_SECRET must be set, or config access throws
   *
   * It answers 404 rather than 403 when disabled: a 403 would confirm the
   * endpoint exists in this deployment.
   */
  @Post('dev-token')
  @Public()
  @RateLimit({ windowSeconds: 60, maxRequests: 20 })
  @ApiOperation({ summary: 'Mint a dev token (AUTH_MODE=local-dev only)' })
  async devToken(
    @Body(zodPipe(DevTokenSchema)) body: DevTokenRequest,
  ): Promise<{ accessToken: string; expiresIn: number; user: AuthenticatedUser }> {
    if (!this.config.isLocalDevAuth) {
      throw new NotFoundException();
    }

    // Stable pseudo-identity per email, so signing in twice as the same address
    // resolves to the same user row rather than creating a new one each time.
    const existing = await this.prisma.user.findUnique({
      where: { email: body.email },
      select: { supabaseUserId: true },
    });

    const subject = existing?.supabaseUserId ?? randomUUID();

    const { accessToken, expiresIn } = await this.localDev.mint(
      subject,
      body.email,
    );

    // Round-trip through the real authentication path so provisioning, the
    // soft-delete check and role resolution are all exercised — the dev path
    // must not be a shortcut around the logic it is meant to test.
    const user = await this.authService.authenticate(accessToken);

    // Role is requested at mint time purely so the admin path is testable
    // locally. This is the one place a role is assigned from input, and it is
    // unreachable outside local-dev.
    if (body.role !== user.role) {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { role: body.role },
        select: { role: true },
      });
      user.role = updated.role;
    }

    return { accessToken, expiresIn, user };
  }
}
