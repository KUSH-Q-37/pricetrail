/**
 * Integration tests for the fetch layer.
 *
 * These exercise the HTTP strategy, the Playwright strategy and the adapter's
 * escalation ladder against a LOCAL server that serves the saved fixtures.
 *
 * Serving fixtures locally rather than hitting amazon.in is deliberate and not
 * merely polite: a suite that depends on a live third party is
 * non-deterministic, unrunnable in CI, and rate-limited by someone else. Here
 * every status code, challenge page and broken-selector case is reproducible
 * on demand — including the ones that are hard to provoke in the wild.
 *
 * Run: pnpm --filter @pricetrail/marketplace test:integration
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import { AmazonAdapter } from '../src/amazon/amazon.adapter';
import { parseAmazonProduct } from '../src/amazon/amazon.parser';
import { FlipkartAdapter } from '../src/flipkart/flipkart.adapter';
import { parseFlipkartProduct } from '../src/flipkart/flipkart.parser';
import { HttpFetcher } from '../src/fetch/http-fetcher';
import { PlaywrightFetcher } from '../src/fetch/playwright-fetcher';
import { BrowserPool } from '../src/browser/browser-pool';
import { FetchError } from '../src/adapter';
import { signRequest, toAmzDate, toDateStamp } from '../src/amazon/paapi-signer';

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

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

/**
 * Local stand-in for both marketplaces. Paths are `/amazon/<name>` and
 * `/flipkart/<name>`; `?status=NNN` forces an arbitrary HTTP status.
 */
function startFixtureServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const [, platform, name] = url.pathname.split('/');

      const statusOverride = url.searchParams.get('status');
      if (statusOverride) {
        res.writeHead(Number(statusOverride), { 'content-type': 'text/html' });
        res.end('<html><body>error</body></html>');
        return;
      }

      try {
        const body = readFileSync(
          join(__dirname, 'fixtures', platform ?? 'amazon', `${name}.html`),
          'utf8',
        );
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body);
      } catch {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('<html><body>not found</body></html>');
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
  const { server, baseUrl } = await startFixtureServer();

  try {
    // -----------------------------------------------------------------------
    section('SIGV4 SIGNER (deterministic, format-checked)');
    // -----------------------------------------------------------------------
    {
      const fixedDate = new Date('2026-08-06T12:34:56.000Z');
      check('amz date format', toAmzDate(fixedDate), '20260806T123456Z');
      check('date stamp format', toDateStamp(fixedDate), '20260806');

      const signed = signRequest({
        method: 'POST',
        host: 'webservices.amazon.in',
        path: '/paapi5/getitems',
        region: 'eu-west-1',
        service: 'ProductAdvertisingAPI',
        target: 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems',
        payload: '{"ItemIds":["B0CHX1W1XY"]}',
        accessKey: 'AKIAEXAMPLE',
        secretKey: 'secretexamplekey',
        now: fixedDate,
      });

      check('signature is 64 hex chars', /^[0-9a-f]{64}$/.test(signed.signature), true);
      check('headers are lowercase + sorted in the canonical request',
        signed.canonicalRequest.split('\n').slice(3, 8).join(','),
        'content-encoding:amz-1.0,content-type:application/json; charset=utf-8,host:webservices.amazon.in,x-amz-date:20260806T123456Z,x-amz-target:com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems');
      check('string-to-sign starts with the algorithm',
        signed.stringToSign.startsWith('AWS4-HMAC-SHA256\n20260806T123456Z\n20260806/eu-west-1/ProductAdvertisingAPI/aws4_request'), true);
      check('authorization header shape',
        /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260806\/eu-west-1\/ProductAdvertisingAPI\/aws4_request, SignedHeaders=content-encoding;content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/.test(
          signed.headers['Authorization'] ?? ''), true);

      // Same inputs must always produce the same signature.
      const again = signRequest({
        method: 'POST', host: 'webservices.amazon.in', path: '/paapi5/getitems',
        region: 'eu-west-1', service: 'ProductAdvertisingAPI',
        target: 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems',
        payload: '{"ItemIds":["B0CHX1W1XY"]}', accessKey: 'AKIAEXAMPLE',
        secretKey: 'secretexamplekey', now: fixedDate,
      });
      check('signing is deterministic', again.signature, signed.signature);

      const differentPayload = signRequest({
        method: 'POST', host: 'webservices.amazon.in', path: '/paapi5/getitems',
        region: 'eu-west-1', service: 'ProductAdvertisingAPI',
        target: 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems',
        payload: '{"ItemIds":["B0DIFFERENT"]}', accessKey: 'AKIAEXAMPLE',
        secretKey: 'secretexamplekey', now: fixedDate,
      });
      check('payload change alters the signature',
        differentPayload.signature !== signed.signature, true);
    }

    // -----------------------------------------------------------------------
    section('HTTP STRATEGY (against local fixture server)');
    // -----------------------------------------------------------------------
    const http = new HttpFetcher(parseAmazonProduct);
    {
      const outcome = await http.fetch({
        externalId: 'B0CHX1W1XY',
        url: `${baseUrl}/amazon/iphone-in-stock`,
      });
      check('strategy name', outcome.strategy, 'HTTP_CHEERIO');
      check('title', outcome.product.title, 'Apple iPhone 15 Pro (256 GB) - Natural Titanium');
      check('price', outcome.product.priceMinor, 13499900);
      check('source is SCRAPE', outcome.product.source, 'SCRAPE');
      check('http status', outcome.httpStatus, 200);
    }

    for (const [status, expected] of [
      ['404', 'NOT_FOUND'],
      ['429', 'RATE_LIMITED'],
      ['403', 'BLOCKED'],
      ['503', 'RATE_LIMITED'],
    ] as const) {
      let reason = 'none';
      try {
        await http.fetch({ externalId: 'X', url: `${baseUrl}/amazon/x?status=${status}` });
      } catch (error) {
        if (error instanceof FetchError) reason = error.reason;
      }
      check(`HTTP ${status} maps to ${expected}`, reason, expected);
    }

    {
      let reason = 'none';
      try {
        await http.fetch({ externalId: 'B0CHX1W1XY', url: `${baseUrl}/amazon/captcha` });
      } catch (error) {
        if (error instanceof FetchError) reason = error.reason;
      }
      check('captcha -> BOT_CHALLENGE', reason, 'BOT_CHALLENGE');
    }

    {
      let error: FetchError | undefined;
      try {
        await http.fetch({ externalId: 'B0SAMSUNG1', url: `${baseUrl}/amazon/broken-price-selector` });
      } catch (caught) {
        if (caught instanceof FetchError) error = caught;
      }
      check('broken selector -> VALIDATION_FAILED', error?.reason, 'VALIDATION_FAILED');
      check('validation failure is NOT retryable', error?.isRetryable, false);
      check('failure names the field', error?.issues?.some((i) => i.path === 'priceMinor'), true);
    }

    // -----------------------------------------------------------------------
    section('ADAPTER ESCALATION LADDER');
    // -----------------------------------------------------------------------
    {
      const fallbacks: string[] = [];
      const adapter = new AmazonAdapter({
        enableBrowserFallback: false,
        onStrategyFallback: (info) => fallbacks.push(`${info.from}:${info.reason}`),
      });

      const outcome = await adapter.fetchProduct({
        externalId: 'B0CHX1W1XY',
        url: `${baseUrl}/amazon/iphone-in-stock`,
      });
      check('no API credentials -> falls straight to HTTP', outcome.strategy, 'HTTP_CHEERIO');
      check('no fallbacks needed on success', fallbacks.length, 0);

      // 404 must stop the ladder rather than try every strategy.
      let reason = 'none';
      try {
        await adapter.fetchProduct({ externalId: 'X', url: `${baseUrl}/amazon/x?status=404` });
      } catch (error) {
        if (error instanceof FetchError) reason = error.reason;
      }
      check('404 is terminal', reason, 'NOT_FOUND');
      check('404 did not trigger escalation', fallbacks.length, 0);

      await adapter.dispose();
    }

    // -----------------------------------------------------------------------
    section('BROWSER POOL + PLAYWRIGHT STRATEGY (real Chromium)');
    // -----------------------------------------------------------------------
    {
      const pool = new BrowserPool({ headless: true, maxContexts: 2 });
      try {
        check('pool starts unlaunched', pool.stats.launched, false);

        const fetcher = new PlaywrightFetcher(pool, parseAmazonProduct);
        const outcome = await fetcher.fetch({
          externalId: 'B0CHX1W1XY',
          url: `${baseUrl}/amazon/iphone-in-stock`,
        });

        check('strategy name', outcome.strategy, 'PLAYWRIGHT');
        check('same parser -> same price as HTTP path', outcome.product.priceMinor, 13499900);
        check('same title', outcome.product.title, 'Apple iPhone 15 Pro (256 GB) - Natural Titanium');
        check('browser launched on demand', pool.stats.launched, true);
        check('contexts released after use', pool.stats.activeContexts, 0);

        // Concurrency: contexts must be isolated and all must complete.
        const results = await Promise.all([
          fetcher.fetch({ externalId: 'A', url: `${baseUrl}/amazon/iphone-in-stock` }),
          fetcher.fetch({ externalId: 'B', url: `${baseUrl}/amazon/fridge-limited-stock` }),
        ]);
        check('concurrent fetch 1', results[0]?.product.priceMinor, 13499900);
        check('concurrent fetch 2', results[1]?.product.priceMinor, 2899000);
        check('all contexts released', pool.stats.activeContexts, 0);

        let botReason = 'none';
        try {
          await fetcher.fetch({ externalId: 'C', url: `${baseUrl}/amazon/captcha` });
        } catch (error) {
          if (error instanceof FetchError) botReason = error.reason;
        }
        check('captcha detected in browser path too', botReason, 'BOT_CHALLENGE');

        // Same pool, different parser: proves the fetch strategies really are
        // platform-agnostic after the refactor.
        const fkFetcher = new PlaywrightFetcher(pool, parseFlipkartProduct);
        const fkOutcome = await fkFetcher.fetch({
          externalId: 'MOBGTAGPTB3VS24W',
          url: `${baseUrl}/flipkart/iphone-jsonld`,
        });
        check('one browser pool serves both platforms', fkOutcome.product.platform, 'FLIPKART');
        check('flipkart price via browser', fkOutcome.product.priceMinor, 13290000);
      } finally {
        await pool.dispose();
      }
    }

    // -----------------------------------------------------------------------
    section('FLIPKART STRATEGIES + ADAPTER');
    // -----------------------------------------------------------------------
    {
      const fkHttp = new HttpFetcher(parseFlipkartProduct);

      const outcome = await fkHttp.fetch({
        externalId: 'MOBGTAGPTB3VS24W',
        url: `${baseUrl}/flipkart/iphone-jsonld`,
      });
      check('platform', outcome.product.platform, 'FLIPKART');
      check('title', outcome.product.title, 'APPLE iPhone 15 Pro (Natural Titanium, 256 GB)');
      check('price from JSON-LD', outcome.product.priceMinor, 13290000);
      check('mrp from DOM', outcome.product.mrpMinor, 14990000);

      // Redeployed frontend: every class hash changed, JSON-LD unchanged.
      const survived = await fkHttp.fetch({
        externalId: 'ACCGXYZ7HFGHZZZZ',
        url: `${baseUrl}/flipkart/hashed-classes-changed`,
      });
      check('survives a class-hash redeploy', survived.product.priceMinor, 2699000);

      let pxReason = 'none';
      try {
        await fkHttp.fetch({
          externalId: 'X',
          url: `${baseUrl}/flipkart/perimeterx-challenge`,
        });
      } catch (error) {
        if (error instanceof FetchError) pxReason = error.reason;
      }
      // PerimeterX serves HTTP 200, so this must come from markers, not status.
      check('PerimeterX (HTTP 200) -> BOT_CHALLENGE', pxReason, 'BOT_CHALLENGE');

      const fallbacks: string[] = [];
      const adapter = new FlipkartAdapter({
        enableBrowserFallback: false,
        onStrategyFallback: (info) => fallbacks.push(`${info.from}:${info.reason}`),
      });

      const viaAdapter = await adapter.fetchProduct({
        externalId: 'MOBGTAGPTB3VS24W',
        url: `${baseUrl}/flipkart/iphone-jsonld`,
      });
      check('adapter falls to HTTP with no affiliate creds', viaAdapter.strategy, 'HTTP_CHEERIO');

      let notFound = 'none';
      try {
        await adapter.fetchProduct({ externalId: 'X', url: `${baseUrl}/flipkart/x?status=404` });
      } catch (error) {
        if (error instanceof FetchError) notFound = error.reason;
      }
      check('404 terminal on Flipkart too', notFound, 'NOT_FOUND');
      check('no escalation on 404', fallbacks.length, 0);

      await adapter.dispose();
    }
  } finally {
    server.close();
  }

  console.log(`\n${'='.repeat(60)}`);
  if (failed > 0) console.log(`FAILURES:\n${failures.join('\n')}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
