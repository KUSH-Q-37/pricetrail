import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.schema';

/**
 * Global configuration module.
 *
 * `validate` runs the Zod schema at bootstrap; a failure throws before any
 * module is instantiated, so the process exits instead of serving traffic with
 * a broken configuration.
 *
 * The monorepo keeps one .env at the root rather than one per app, so all
 * processes (api, worker, scheduler) agree on connection strings by
 * construction instead of by convention.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
