// Generated client lives in ../generated/client (see schema.prisma) so that
// `pnpm deploy` carries it into the Docker images.
import { PrismaClient } from '../generated/client';

export * from '../generated/client';
export * from './vector';

/**
 * A single PrismaClient per process.
 *
 * Next.js and NestJS both hot-reload modules in development, and a fresh
 * PrismaClient per reload exhausts the Postgres connection limit within a
 * few minutes. Caching on globalThis survives module re-evaluation; in
 * production the module is evaluated once and the cache is unused.
 */
const globalForPrisma = globalThis as unknown as {
  __pricetrailPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['warn', 'error']
        : ['query', 'warn', 'error'],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.__pricetrailPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__pricetrailPrisma = prisma;
}
