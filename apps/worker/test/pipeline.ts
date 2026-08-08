/**
 * Phase 11 end-to-end: PENDING product -> fetched -> READY with a real price
 * point, plus the failure paths.
 *
 * Uses a LOCAL fixture server and a real AmazonAdapter pointed at it, so the
 * whole chain runs — adapter, parser, boundary validation, transaction,
 * audit row, failure escalation — without touching amazon.in. That is what
 * makes these behaviours reproducible: a 429, a captcha and a broken selector
 * are all one URL away here and effectively unprovokeable in the wild.
 *
 *   pnpm --filter @pricetrail/worker test:pipeline
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import { PrismaClient, ProductStatus, type Platform } from '@pricetrail/database';
import { AmazonAdapter, type MarketplaceAdapter } from '@pricetrail/marketplace';
import {
  QUEUE,
  QueueProducer,
  Worker,
  assertQueueSafeRedis,
  createRedisConnection,
} from '@pricetrail/queue';

import { FAILURE_PAUSE_THRESHOLD, scrapeListing } from '../src/jobs/scrape-listing';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    failures.push(`  ${name}\n      expected ${e}\n      actual   ${a}`);
  }
}

const section = (title: string) => console.log(`\n=== ${title} ===`);

const FIXTURES = join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'marketplace',
  'test',
  'fixtures',
);

function startFixtureServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const [, platform, name] = url.pathname.split('/');

      const status = url.searchParams.get('status');
      if (status) {
        res.writeHead(Number(status), { 'content-type': 'text/html' });
        res.end('<html><body>error</body></html>');
        return;
      }

      try {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(readFileSync(join(FIXTURES, platform ?? 'amazon', `${name}.html`), 'utf8'));
      } catch {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const { server, baseUrl } = await startFixtureServer();

  const adapter = new AmazonAdapter({ enableBrowserFallback: false });
  const getAdapter = (_platform: Platform): MarketplaceAdapter => adapter;

  const externalId = `B0PIPE${Date.now().toString().slice(-4)}`;
  let productId = '';
  let listingId = '';

  try {
    // -----------------------------------------------------------------------
    section('SETUP: a PENDING product, exactly as ingest creates it');
    // -----------------------------------------------------------------------
    const placeholder = `Amazon product ${externalId}`;
    const created = await prisma.product.create({
      data: {
        status: ProductStatus.PENDING,
        displayTitle: placeholder,
        normalizedTitle: placeholder.toLowerCase(),
        listings: {
          create: {
            platform: 'AMAZON',
            externalId,
            url: `${baseUrl}/amazon/iphone-in-stock`,
            title: placeholder,
            normalizedTitle: placeholder.toLowerCase(),
            trackingEnabled: true,
          },
        },
      },
      include: { listings: true },
    });
    productId = created.id;
    listingId = created.listings[0]!.id;

    check('starts PENDING', created.status, 'PENDING');
    check('starts with a placeholder title', created.displayTitle, placeholder);
    check('starts with no price', created.listings[0]!.currentPriceMinor, null);

    // -----------------------------------------------------------------------
    section('SCRAPE: the job that closes the loop');
    // -----------------------------------------------------------------------
    const result = await scrapeListing(
      { prisma, getAdapter },
      {
        listingId,
        platform: 'AMAZON',
        externalId,
        url: `${baseUrl}/amazon/iphone-in-stock`,
        queueJobId: 'test-job-1',
      },
    );

    check('succeeded', result.status, 'SUCCEEDED');
    check('used the cheap HTTP path', result.strategy, 'HTTP_CHEERIO');
    check('wrote a price point', result.pricePointWritten, true);

    const afterProduct = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: { listings: true },
    });
    const afterListing = afterProduct.listings[0]!;

    check('product promoted to READY', afterProduct.status, 'READY');
    check('real title replaced the placeholder', afterProduct.displayTitle, 'Apple iPhone 15 Pro (256 GB) - Natural Titanium');
    check('brand extracted', afterProduct.brand, 'Apple');
    check('attributes normalised onto the product', (afterProduct.attributes as Record<string, unknown>)['storage_gb'], 256);
    check('listing price populated', afterListing.currentPriceMinor, 13499900);
    check('MRP populated', afterListing.mrpMinor, 14990000);
    check('EAN captured', afterListing.ean, '0195949022029');
    check('failure counter reset', afterListing.consecutiveFailures, 0);

    const points = await prisma.pricePoint.findMany({ where: { listingId } });
    check('exactly one price point', points.length, 1);
    check('price point value', points[0]!.priceMinor, 13499900);

    const audit = await prisma.scrapeJob.findMany({ where: { listingId } });
    check('audit row written', audit.length, 1);
    check('audit says succeeded', audit[0]!.status, 'SUCCEEDED');
    check('audit records the strategy', audit[0]!.strategy, 'HTTP_CHEERIO');
    check('audit records duration', typeof audit[0]!.durationMs, 'number');

    // -----------------------------------------------------------------------
    section('IDEMPOTENCY: a redelivered job must not double-write');
    // -----------------------------------------------------------------------
    // BullMQ redelivers a job whose worker died after the DB write but before
    // the ack. The (listing_id, captured_on) primary key plus skipDuplicates
    // is what makes that harmless.
    const rerun = await scrapeListing(
      { prisma, getAdapter },
      {
        listingId,
        platform: 'AMAZON',
        externalId,
        url: `${baseUrl}/amazon/iphone-in-stock`,
        queueJobId: 'test-job-1-redelivered',
      },
    );

    check('re-run succeeds', rerun.status, 'SUCCEEDED');
    check('but writes NO second price point', rerun.pricePointWritten, false);

    const pointsAfter = await prisma.pricePoint.findMany({ where: { listingId } });
    check('still exactly one price point for today', pointsAfter.length, 1);

    // -----------------------------------------------------------------------
    section('FAILURE: broken selector must NOT overwrite a good price');
    // -----------------------------------------------------------------------
    let threw = false;
    let reason = '';
    try {
      await scrapeListing(
        { prisma, getAdapter },
        {
          listingId,
          platform: 'AMAZON',
          externalId,
          url: `${baseUrl}/amazon/broken-price-selector`,
        },
      );
    } catch (error) {
      threw = true;
      reason = (error as { reason?: string }).reason ?? '';
    }

    const failedResult = threw ? { status: 'FAILED', reason } : undefined;
    // VALIDATION_FAILED is non-retryable, so scrapeListing returns rather than
    // throwing — either way it must not have written anything.
    const stillGood = await prisma.marketplaceListing.findUniqueOrThrow({
      where: { id: listingId },
    });

    check('price survived the failed fetch', stillGood.currentPriceMinor, 13499900);
    check('failure counter incremented', stillGood.consecutiveFailures, 1);
    check('tracking still enabled after 1 failure', stillGood.trackingEnabled, true);

    const auditAfterFail = await prisma.scrapeJob.findMany({
      where: { listingId, status: 'FAILED' },
    });
    check('failure recorded in the audit trail', auditAfterFail.length > 0, true);
    check('audit names the reason', auditAfterFail[0]!.errorCode, 'VALIDATION_FAILED');
    void failedResult;

    // -----------------------------------------------------------------------
    section('AUTO-PAUSE after repeated failures');
    // -----------------------------------------------------------------------
    for (let i = 0; i < FAILURE_PAUSE_THRESHOLD; i++) {
      try {
        await scrapeListing(
          { prisma, getAdapter },
          {
            listingId,
            platform: 'AMAZON',
            externalId,
            url: `${baseUrl}/amazon/broken-price-selector`,
          },
        );
      } catch {
        // expected
      }
    }

    const paused = await prisma.marketplaceListing.findUniqueOrThrow({
      where: { id: listingId },
    });
    check(`tracking auto-paused at >=${FAILURE_PAUSE_THRESHOLD} failures`, paused.trackingEnabled, false);
    check('price STILL preserved', paused.currentPriceMinor, 13499900);

    // -----------------------------------------------------------------------
    section('HTTP ERROR MAPPING');
    // -----------------------------------------------------------------------
    for (const [status, expected] of [['404', 'NOT_FOUND'], ['429', 'RATE_LIMITED']] as const) {
      let code = '';
      try {
        await scrapeListing(
          { prisma, getAdapter },
          {
            listingId,
            platform: 'AMAZON',
            externalId,
            url: `${baseUrl}/amazon/x?status=${status}`,
          },
        );
      } catch (error) {
        code = (error as { reason?: string }).reason ?? '';
      }
      const latest = await prisma.scrapeJob.findFirst({
        where: { listingId },
        orderBy: { createdAt: 'desc' },
      });
      check(`HTTP ${status} recorded as ${expected}`, latest?.errorCode, expected);
      void code;
    }
    // -----------------------------------------------------------------------
    section('QUEUE ROUND TRIP (through real BullMQ, not a direct call)');
    // -----------------------------------------------------------------------
    // This section exists because of a bug that shipped past 32 green tests:
    // every case above calls scrapeListing() directly, so NOTHING exercised
    // BullMQ's own validation. BullMQ reserves ':' in BOTH queue names and
    // custom job IDs, and the natural-looking `scrape:listing` /
    // `ingest:<uuid>` both throw at enqueue time. Testing the job function in
    // isolation can never catch that — only a real round trip can.
    {
      const connection = createRedisConnection(
        process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      );
      const producer = new QueueProducer(connection);
      const received: string[] = [];

      const worker = new Worker(
        QUEUE.scrape,
        async (job) => {
          received.push((job.data as { listingId: string }).listingId);
        },
        { connection },
      );

      try {
        await assertQueueSafeRedis(connection);
        check('redis is queue-safe (noeviction)', true, true);

        // Exactly the id shape the API produces on ingest.
        const jobId = await producer.enqueue(
          QUEUE.scrape,
          {
            listingId,
            platform: 'AMAZON',
            externalId,
            url: `${baseUrl}/amazon/iphone-in-stock`,
          },
          { jobId: `ingest-${listingId}` },
        );
        check('enqueue accepted the job id shape', typeof jobId, 'string');

        // Re-enqueueing the same id must be deduped, not doubled.
        await producer.enqueue(
          QUEUE.scrape,
          {
            listingId,
            platform: 'AMAZON',
            externalId,
            url: `${baseUrl}/amazon/iphone-in-stock`,
          },
          { jobId: `ingest-${listingId}` },
        );

        for (let i = 0; i < 40 && received.length === 0; i++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        check('worker received the job', received[0], listingId);
        check('duplicate jobId did not enqueue twice', received.length, 1);
      } finally {
        await worker.close();
        await producer.close();
        connection.disconnect();
      }
    }
  } finally {
    // Clean up so re-runs start fresh.
    if (productId) {
      await prisma.scrapeJob.deleteMany({ where: { listingId } });
      await prisma.pricePoint.deleteMany({ where: { listingId } });
      await prisma.marketplaceListing.deleteMany({ where: { productId } });
      await prisma.product.delete({ where: { id: productId } }).catch(() => undefined);
    }
    server.close();
    await prisma.$disconnect();
  }

  console.log(`\n${'='.repeat(60)}`);
  if (failed > 0) console.log(`FAILURES:\n${failures.join('\n')}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((error: unknown) => {
  console.error('\npipeline test threw:', error);
  process.exit(1);
});
