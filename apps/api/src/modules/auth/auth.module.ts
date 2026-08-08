import { Global, Module, type Provider } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalDevVerifier } from './local-dev.verifier';
import { RolesGuard } from './roles.guard';
import { SupabaseJwtVerifier } from './supabase-jwt.verifier';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TOKEN_VERIFIER } from './token-verifier';

/**
 * Selects the verifier from configuration.
 *
 * The factory is what makes AUTH_MODE a genuine seam: nothing downstream —
 * AuthService, the guards, the controllers — knows which implementation is
 * live. Moving from local-dev to Supabase changes environment variables, not
 * code.
 */
const tokenVerifierProvider: Provider = {
  provide: TOKEN_VERIFIER,
  inject: [AppConfigService, SupabaseJwtVerifier, LocalDevVerifier],
  useFactory: (
    config: AppConfigService,
    supabase: SupabaseJwtVerifier,
    localDev: LocalDevVerifier,
  ) => (config.isLocalDevAuth ? localDev : supabase),
};

/**
 * Verifier instances are constructed lazily.
 *
 * SupabaseJwtVerifier's constructor reads SUPABASE_URL and LocalDevVerifier's
 * reads LOCAL_DEV_AUTH_SECRET — and exactly one of those is configured at a
 * time. Instantiating both eagerly would throw for whichever mode is inactive,
 * so each is wrapped in a factory that only runs when its mode is selected.
 */
const supabaseVerifierProvider: Provider = {
  provide: SupabaseJwtVerifier,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) =>
    config.isLocalDevAuth ? null : new SupabaseJwtVerifier(config),
};

const localDevVerifierProvider: Provider = {
  provide: LocalDevVerifier,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) =>
    config.isLocalDevAuth ? new LocalDevVerifier(config) : null,
};

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    supabaseVerifierProvider,
    localDevVerifierProvider,
    tokenVerifierProvider,
    AuthService,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
