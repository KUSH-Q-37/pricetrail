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

    // The only guard left. There is no sign-in, so there is no identity to
    // authenticate and nothing to authorise against — every route is public
    // and rate limiting buckets by IP for everyone.
    //
    // That makes this guard the ONLY thing standing between the internet and
    // POST /products/ingest, which enrols a product in daily fetching forever.
    // Its limits are the abuse budget now, not a politeness measure.
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
