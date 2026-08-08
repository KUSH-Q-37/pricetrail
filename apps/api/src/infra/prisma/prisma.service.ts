import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@pricetrail/database';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Prisma bound to the Nest lifecycle.
 *
 * This extends PrismaClient rather than reusing the `prisma` singleton
 * exported from @pricetrail/database. That singleton exists to survive
 * Next.js hot-reload in the web app; here Nest owns the lifecycle and must be
 * able to connect eagerly and disconnect on shutdown.
 *
 * Connecting in `onModuleInit` is deliberate: Prisma connects lazily by
 * default, which means an unreachable database surfaces as a failed request
 * instead of a failed deploy. We want the container to fail its health check
 * and be rolled back.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    @InjectPinoLogger(PrismaService.name)
    private readonly logger: PinoLogger,
  ) {
    super({
      log:
        process.env['NODE_ENV'] === 'production'
          ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
          : [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
    });
  }

  async onModuleInit(): Promise<void> {
    this.$on('warn' as never, (event: { message: string }) => {
      this.logger.warn({ prisma: event }, event.message);
    });

    this.$on('error' as never, (event: { message: string }) => {
      this.logger.error({ prisma: event }, event.message);
    });

    await this.$connect();
    this.logger.info('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.info('Prisma disconnected');
  }

  /**
   * Cheap liveness probe for the readiness endpoint. `SELECT 1` avoids
   * touching any application table, so it stays valid across migrations.
   */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
