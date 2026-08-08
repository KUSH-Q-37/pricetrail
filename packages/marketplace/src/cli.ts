/**
 * Selector-debugging CLI.
 *
 * When a fetch starts failing in production, the question is always "which
 * selector broke, and what did the page actually contain?". This answers it in
 * one command instead of a round trip through the worker, the queue and the
 * database.
 *
 *   pnpm --filter @pricetrail/marketplace fetch <url> [--strategy=...] [--html=file]
 *
 * `--html` parses a saved file with no network at all, which is how you
 * reproduce yesterday's failure from an archived page.
 */
import { readFileSync } from 'node:fs';

import { FetchError, type MarketplaceAdapter } from './adapter';
import { AmazonAdapter } from './amazon/amazon.adapter';
import { parseAmazonProduct } from './amazon/amazon.parser';
import { FlipkartAdapter } from './flipkart/flipkart.adapter';
import { parseFlipkartProduct } from './flipkart/flipkart.parser';
import { validateFetchedProduct } from './product-data.schema';
import { normalizeAttributes } from './shared/attributes';
import { parseMarketplaceUrl } from './url-parser';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

/**
 * First positional argument.
 *
 * Not `argv[2]`: package managers forward a literal `--` separator into argv,
 * so a fixed index silently picks up "--" as the URL.
 */
function positional(): string | undefined {
  return process.argv
    .slice(2)
    .find((value) => value !== '--' && !value.startsWith('-'));
}

async function main(): Promise<void> {
  const target = positional();
  const htmlFile = arg('html');

  if (!target) {
    console.error('usage: fetch <url> [--strategy=API|HTTP_CHEERIO|PLAYWRIGHT] [--html=file]');
    process.exit(1);
  }

  const parsed = parseMarketplaceUrl(target);
  console.log(`platform   : ${parsed.platform}`);
  console.log(`externalId : ${parsed.externalId}`);
  console.log(`canonical  : ${parsed.canonicalUrl}`);

  const parse =
    parsed.platform === 'AMAZON' ? parseAmazonProduct : parseFlipkartProduct;

  // --- offline mode: parse a saved page -----------------------------------
  if (htmlFile) {
    const html = readFileSync(htmlFile, 'utf8');
    const raw = parse(html, {
      externalId: parsed.externalId,
      url: parsed.canonicalUrl,
      source: 'SCRAPE',
    });

    const validated = validateFetchedProduct(raw);
    console.log('\n--- parsed ---');
    console.log(JSON.stringify(raw, null, 2));
    console.log('\n--- attributes ---');
    console.log(JSON.stringify(normalizeAttributes(raw.rawAttributes ?? {}), null, 2));
    console.log(`\nvalidation : ${validated.ok ? 'PASS' : 'FAIL'}`);
    if (!validated.ok) {
      for (const issue of validated.issues) {
        console.log(`  ${issue.path}: ${issue.message}`);
      }
      process.exit(1);
    }
    return;
  }

  // --- live mode ----------------------------------------------------------
  const paapiKey = process.env['PAAPI_ACCESS_KEY'];
  const paapiSecret = process.env['PAAPI_SECRET_KEY'];
  const paapiTag = process.env['PAAPI_PARTNER_TAG'];

  const onStrategyFallback = (info: { from: string; reason: string }) =>
    console.log(`  ! ${info.from} failed (${info.reason}) — escalating`);

  const adapter: MarketplaceAdapter =
    parsed.platform === 'AMAZON'
      ? new AmazonAdapter({
          paapi:
            paapiKey && paapiSecret && paapiTag
              ? { accessKey: paapiKey, secretKey: paapiSecret, partnerTag: paapiTag }
              : undefined,
          onStrategyFallback,
        })
      : new FlipkartAdapter({
          affiliate:
            process.env['FLIPKART_AFFILIATE_ID'] && process.env['FLIPKART_AFFILIATE_TOKEN']
              ? {
                  affiliateId: process.env['FLIPKART_AFFILIATE_ID'],
                  affiliateToken: process.env['FLIPKART_AFFILIATE_TOKEN'],
                }
              : undefined,
          onStrategyFallback,
        });

  try {
    const outcome = await adapter.fetchProduct({
      externalId: parsed.externalId,
      url: parsed.canonicalUrl,
      strategy: arg('strategy') as never,
    });

    console.log(`\nstrategy   : ${outcome.strategy}  (${outcome.durationMs}ms)`);
    console.log(JSON.stringify(outcome.product, null, 2));
    console.log('\n--- attributes ---');
    console.log(JSON.stringify(normalizeAttributes(outcome.product.rawAttributes), null, 2));
  } catch (error) {
    if (error instanceof FetchError) {
      console.error(`\nFAILED: ${error.reason} — ${error.message}`);
      for (const issue of error.issues ?? []) {
        console.error(`  ${issue.path}: ${issue.message}`);
      }
      process.exit(1);
    }
    throw error;
  } finally {
    await adapter.dispose();
  }
}

void main();
