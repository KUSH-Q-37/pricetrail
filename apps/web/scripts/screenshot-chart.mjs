/**
 * Render the chart in a real browser and capture it.
 *
 * The palette validator checks colour; it cannot see label collisions, axis
 * overflow, or a container too short for its x-axis band. Those need eyes on
 * the actual pixels.
 */
import { chromium } from 'playwright';

const [, , productId, token] = process.argv;
if (!productId || !token) {
  console.error('usage: node screenshot-chart.mjs <productId> <accessToken>');
  process.exit(1);
}

const browser = await chromium.launch();

for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    colorScheme: theme,
  });
  const page = await context.newPage();

  // Seed the local-dev session before any script runs, so the auth provider
  // restores it instead of redirecting to /login.
  await page.addInitScript(
    ([tok, mode]) => {
      localStorage.setItem(
        'pricetrail.dev-session',
        JSON.stringify({ accessToken: tok, user: {} }),
      );
      localStorage.setItem('theme', mode);
    },
    [token, theme],
  );

  await page.goto(`http://localhost:3000/products/${productId}`, {
    waitUntil: 'domcontentloaded',
  });

  // Wait for the chart canvas rather than a fixed sleep.
  await page.waitForSelector('canvas', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // Horizontal overflow is the layout bug a static check misses entirely.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  const canvases = await page.locator('canvas').count();

  console.log(`${theme}: canvases=${canvases} horizontalOverflow=${overflow}`);

  await page.screenshot({ path: `chart-${theme}.png`, fullPage: false });
  await context.close();
}

await browser.close();
console.log('wrote chart-light.png and chart-dark.png');
