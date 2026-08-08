import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../config/app-config.service';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  constructor(
    config: AppConfigService,
    @InjectPinoLogger(RedisService.name)
    private readonly logger: PinoLogger,
  ) {
    this.client = new Redis(config.redisUrl, {
      // BullMQ requires this to be null on its own connections; keeping the
      // API's connection consistent avoids surprises when the queue producers
      // land in Phase 11.
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
    });

    this.client.on('error', (error: Error) => {
      // Logged, never thrown: ioredis reconnects on its own, and an unhandled
      // 'error' event would take the process down during a transient blip.
      this.logger.error({ err: error }, 'Redis connection error');
    });

    this.client.on('ready', () => this.logger.info('Redis ready'));
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.info('Redis disconnected');
  }

  async ping(): Promise<void> {
    const reply = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error(`Unexpected PING reply: ${reply}`);
    }
  }
}
