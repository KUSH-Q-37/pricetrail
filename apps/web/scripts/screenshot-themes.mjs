/**
 * Capture the landing page in every theme, and a couple of accents.
 *
 * The palette in globals.css is DERIVED — a theme supplies surfaces, an accent
 * supplies a hue, and `--primary` is computed from both. That is what stops the
 * fifteen combinations from rotting, but it also means no single one of them
 * has ever been looked at by a human unless something renders it. This does.
 *
 * Amber on midnight is in the list on purpose: amber is the accent whose
 * lightness had to be tuned separately to stay readable, so it is the one most
 * likely to be wrong.
 *
 * usage: node scripts/screenshot-themes.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const baseUrl = process.argv[2] ?? 'http://localhost:3000';
// Playwright's `path` option wants a real filesystem string, not a URL object.
const outDir = fileURLToPath(new URL('../screenshots/', import.meta.url));

const SHOTS = [
  { theme: 'light', accent: 'indigo' },
  { theme: 'dark', accent: 'indigo' },
  { theme: 'midnight', accent: 'violet' },
  { theme: 'midnight', accent: 'amber' },
  { theme: 'light', accent: 'emerald' },
  { theme: 'dark', accent: 'rose' },
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();

for (const { theme, accent } of SHOTS) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Seeded BEFORE any script runs, so the pre-hydration head scripts read these
  // and the very first paint is already correct. Setting them after load would
  // test a code path no real user takes.
  await page.addInitScript(
    ([t, a]) => {
      localStorage.setItem('theme', t);
      localStorage.setItem('pricetrail-accent', a);
    },
    [theme, accent],
  );

  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  // Let the entrance stagger finish and the canvas draw a few frames, otherwise
  // every shot catches the hero mid-fade and tells you nothing about the design.
  await page.waitForTimeout(2200);

  const name = `landing-${theme}-${accent}.png`;
  await page.screenshot({ path: join(outDir, name) });
  console.log(`captured ${name}`);

  await context.close();
}

// One with the appearance popover open, since that surface only exists on click
// and is the one place all five accents appear at once.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'midnight');
    localStorage.setItem('pricetrail-accent', 'violet');
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(outDir, 'theme-picker.png') });
  console.log('captured theme-picker.png');
  await context.close();
}

// And one with the OS motion preference set to reduce.
//
// This is the shot most worth having. Reduced motion is not a variant of the
// design, it is a correctness requirement, and its failure mode is severe and
// invisible in every other capture: `.stagger-in` starts at opacity 0 and
// depends on an animation to become visible, so anything that kills that
// animation without restoring opacity deletes the headline outright. That has
// already happened once here, via an `animation` shorthand collision.
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('pricetrail-accent', 'indigo');
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Asserted, not just captured: a human skimming a screenshot can miss a
  // missing word, and this one is load-bearing.
  const headline = await page.evaluate(() => {
    const el = document.querySelector('.text-gradient');
    if (!el) return { ok: false, reason: 'no .text-gradient element' };
    const style = getComputedStyle(el);
    const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
    return {
      ok:
        Number(parent?.opacity ?? '1') > 0.99 &&
        style.webkitTextFillColor !== 'rgba(0, 0, 0, 0)',
      parentOpacity: parent?.opacity,
      fill: style.webkitTextFillColor,
      text: el.textContent,
    };
  });

  if (!headline.ok) {
    console.error('FAIL reduced-motion headline is not visible:', headline);
    process.exitCode = 1;
  } else {
    console.log('ok   reduced-motion headline visible:', JSON.stringify(headline.text));
  }

  await page.screenshot({ path: join(outDir, 'landing-reduced-motion.png') });
  console.log('captured landing-reduced-motion.png');
  await context.close();
}

await browser.close();
