/**
 * Capture the dashboard shell in a dark theme.
 *
 * The API is not expected to be up when this runs — that is the point. The
 * dashboard's error and empty states are the surfaces most likely to have been
 * missed by a theme change, precisely because they are the ones nobody opens on
 * purpose, and an alert styled for a white card is unreadable on a dark one.
 *
 * usage: node scripts/screenshot-dashboard.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const outDir = fileURLToPath(new URL('../screenshots/', import.meta.url));
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();

for (const { theme, accent } of [
  { theme: 'midnight', accent: 'violet' },
  { theme: 'light', accent: 'indigo' },
]) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  await page.addInitScript(
    ([t, a]) => {
      localStorage.setItem('theme', t);
      localStorage.setItem('pricetrail-accent', a);
    },
    [theme, accent],
  );

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const name = `dashboard-${theme}-${accent}.png`;
  await page.screenshot({ path: join(outDir, name) });
  console.log(`captured ${name}`);

  if (consoleErrors.length > 0) {
    console.error(`  uncaught page errors: ${consoleErrors.join(' | ')}`);
    process.exitCode = 1;
  }

  await context.close();
}

await browser.close();
