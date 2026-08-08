/**
 * Standalone worker process.
 *
 * The runtime itself lives in `runtime.ts` so the API can host it too on
 * single-service deployments. This file is only the process wrapper: start it,
 * and translate signals into a graceful stop.
 */

import { startWorkerRuntime } from './runtime';
import { logger } from './logger';

async function main(): Promise<void> {
  const runtime = await startWorkerRuntime();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    await runtime.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  logger.error('worker failed to start', { error: String(error) });
  process.exit(1);
});
