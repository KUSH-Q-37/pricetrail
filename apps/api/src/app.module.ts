import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { RequestContextStore } from './common/context/request-context';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { AppConfigService } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { QueueModule } from './infra/queue/queue.module';
import { RedisModule } from './infra/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { RolesGuard } from './modules/auth/roles.guard';
import { HealthModule } from './modules/health/health.module';
import { MetaModule } from './modules/meta/meta.module';
import { StatsModule } from './modules/stats/stats.module';
import { PricesModule } from './modules/prices/prices.module';
import { ProductsModule } from './modules/products/products.module';

@Module({
  imports: [
    AppConfigModule,

    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logLevel,

          // Pretty output is a development affordance only. In production the
          // logs must stay newline-delimited JSON so the log platform can
          // index them — and pino-pretty costs real throughput.
          transport: config.isProduction
            ? undefined
            : {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  colorize: true,
                  translateTime: 'HH:MM:ss.l',
                  ignore: 'pid,hostname',
                },
              },

          // Reuse the correlation ID rather than minting a second identifier.
          genReqId: () => RequestContextStore.correlationId ?? 'unknown',

          customProps: () => ({
            correlationId: RequestContextStore.correlationId,
            userId: RequestContextStore.get()?.userId,
          }),

          // Probes fire every few seconds. Logging them buries real traffic.
          autoLogging: {
            ignore: (req) => (req.url ?? '').startsWith('/health'),
          },

          // Secrets reach logs through request objects more often than through
          // deliberate logging. Redact at the sink, not at each call site.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-api-key"]',
              'req.body.password',
              'req.body.token',
              'res.headers["set-cookie"]',
            ],
            censor: '[redacted]',
          },
        },
      }),
    }),

    PrismaModule,
    RedisModule,
    QueueModule,
    AuthModule,
    HealthModule,
    MetaModule,
    ProductsModule,
    PricesModule,
    StatsModule,
  ],
  providers: [
    // Registered as APP_FILTER (not useGlobalFilters in main.ts) so the filter
    // participates in DI and can inject the logger.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },

    // ORDER IS SIGNIFICANT. Nest runs global guards in registration order.
    //
    //   1. JwtAuthGuard   authenticates and populates request.user and the
    //                     ambient userId
    //   2. RolesGuard     authorizes, reading the role JwtAuthGuard resolved
    //   3. RateLimitGuard buckets by userId when present, IP otherwise
    //
    // Moving RateLimitGuard first would silently downgrade every authenticated
    // caller to an IP-keyed bucket — so everyone behind one office NAT or
    // mobile carrier gateway would share a single quota.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
