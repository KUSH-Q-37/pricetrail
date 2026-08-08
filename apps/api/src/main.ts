import 'reflect-metadata';

import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { correlationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { AppConfigService } from './config/app-config.service';

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
}

void bootstrap();
