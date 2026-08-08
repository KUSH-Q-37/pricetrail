import 'reflect-metadata';

import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { startWorkerRuntime } from '@pricetrail/worker';

import { AppModule } from './app.module';
import { correlationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { AppConfigService } from './config/app-config.service';
import { PrismaService } from './infra/prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Hold startup logs until the pino logger is wired, so bootstrap output
    // lands in the same structured stream as everything else.
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  const config = app.get(AppConfigService);

  // --- must run before Nest's module middleware ---------------------------
  // See correlation-id.middleware.ts: app.use() attaches to the Express
  // instance immediately, whereas module middleware is registered later during
  // app.init(). This ordering is what guarantees every log line is correlated.
  app.use(correlationIdMiddleware());

  // --- security -----------------------------------------------------------
  app.use(
    helmet({
      // The API serves JSON only; CSP is the frontend's concern and an
      // inherited default here would break Swagger UI for no benefit.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());

  // Rate limiting keys anonymous callers by IP. Behind a load balancer every
  // request carries the balancer's address unless Express is told to trust the
  // proxy and read X-Forwarded-For. Without this, one bucket throttles
  // everyone. `1` = trust exactly one hop; never `true`, which lets a client
  // forge the header and evade limiting entirely.
  app.set('trust proxy', 1);

  app.enableCors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
    exposedHeaders: [
      'x-correlation-id',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
    ],
  });

  // --- routing ------------------------------------------------------------
  // Health probes sit outside /api and outside versioning: an orchestrator's
  // probe URL must never change because the API shipped a v2.
  app.setGlobalPrefix('api', {
    exclude: ['health/live', 'health/ready'],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // --- lifecycle ----------------------------------------------------------
  // Lets onModuleDestroy run on SIGTERM so Prisma and Redis close cleanly
  // instead of the container being killed mid-query.
  app.enableShutdownHooks();

  // --- docs ---------------------------------------------------------------
  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('PriceTrail API')
        .setDescription(
          'Amazon + Flipkart price tracking. Errors follow RFC 7807 ' +
            '(application/problem+json) with a stable machine code in `title`.',
        )
        .setVersion('1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
        .build(),
    );

    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(config.port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(
    `API listening on port ${config.port} [env=${config.nodeEnv}] ` +
      `[docs=${config.swaggerEnabled ? '/api/docs' : 'disabled'}]`,
  );

  // --- co-hosted workers --------------------------------------------------
  // Started after listen() so a slow Redis handshake or ONNX model load can
  // never delay the port opening — the platform health check must be able to
  // succeed while the queue consumers are still warming up.
  //
  // Sharing this process is a real trade-off: a scrape competes with request
  // handling for one event loop, and the embedding model's memory is charged
  // to the API. Concurrency is capped at 1 for that reason. Move to a
  // dedicated worker service and set RUN_WORKERS_IN_API=false when traffic
  // justifies it — the runtime is the same code either way.
  if (config.runWorkersInApi) {
    try {
      const runtime = await startWorkerRuntime({
        redisUrl: config.redisUrl,
        scrapeConcurrency: config.apiScrapeConcurrency,
        // Reuse the API's pool rather than opening a second one; a free
        // Postgres tier counts connections.
        prisma: app.get(PrismaService),
        logger: {
          info: (message, meta) => logger.log({ ...meta }, message),
          warn: (message, meta) => logger.warn({ ...meta }, message),
          error: (message, meta) => logger.error({ ...meta }, message),
        },
      });

      process.on('SIGTERM', () => void runtime.stop());
    } catch (error: unknown) {
      // A queue that will not start must not take the API down with it.
      // Reading existing price history stays available; only new fetches
      // stall, which is far better than a total outage.
      logger.error(
        { error: String(error) },
        'co-hosted workers failed to start; API continues without them',
      );
    }
  }
}

void bootstrap();
