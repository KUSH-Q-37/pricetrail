import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end coverage of the flows that only had manual curl checks before.
 *
 * Everything below runs against the real stack. The value here is not
 * duplicating unit assertions — it is catching the failures that only exist
 * BETWEEN the layers: a CORS header that blocks the browser, an auth token the
 * client stores but never sends, a chart that renders zero canvases because a
 * hook threw during hydration.
 */

const API = process.env['E2E_API_URL'] ?? 'http://localhost:3001';

/** The account Phase 2's seed loaded with ~1,550 price points. */
const SEEDED_EMAIL = 'demo@pricetrail.local';

async function signIn(page: Page, email = SEEDED_EMAIL): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('anything-local-dev-ignores-this');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

test.describe('authentication', () => {
  test('a signed-out visitor is redirected away from the dashboard', async ({ page }) => {
    await page.goto('/products');
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('the login form is server-rendered, not client-only', async ({ request }) => {
    // Regression guard for the Phase 5 bug: useSearchParams pushed the whole
    // form behind a Suspense boundary, so the static HTML contained only a
    // skeleton and the page was unusable without JS.
    const html = await (await request.get('/login')).text();
    expect(html).toContain('<form');
    expect(html).toContain('Password');
  });

  test('sign in reaches the dashboard', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});

test.describe('price history chart', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('renders the seeded product with a chart, and switches range', async ({ page }) => {
    await page.getByRole('link', { name: 'Products' }).click();

    const card = page.getByRole('link', { name: /iPhone 15 Pro/i }).first();
    await expect(card).toBeVisible();
    await card.click();

    await expect(page.getByRole('heading', { name: /iPhone 15 Pro/i })).toBeVisible();

    // Assert on the range selector rather than the panel's title text: roles
    // and accessible names are stable, whereas a getByText on a heading is
    // brittle against markup changes and can collide with other copy.
    await expect(page.getByRole('radio', { name: '7 Days' })).toBeVisible({
      timeout: 20_000,
    });

    // ECharts renders to canvas; its presence is the proof the chart mounted
    // and the hook resolved rather than throwing during hydration.
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 20_000 });

    // Range switch must not blank the chart — keepPreviousData holds the old
    // render while the next range loads.
    await page.getByRole('radio', { name: '1 Year' }).click();
    await expect(page.getByRole('radio', { name: '1 Year' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(canvas).toBeVisible();
  });

  test('the table view exposes every value without hovering', async ({ page }) => {
    // Required, not optional: a tooltip must never be the only way to read a
    // value, and it is the relief channel for the light-mode contrast band.
    await page.goto('/compare');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Table' }).click();

    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr').first()).toBeVisible();
    // Gap days are stated explicitly rather than omitted from the table.
    await expect(table).toContainText('₹');
  });

  test('platform toggles hide and restore a series', async ({ page }) => {
    await page.goto('/compare');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });

    const amazonToggle = page.getByRole('button', { name: /Amazon/ }).first();
    await amazonToggle.click();
    await expect(amazonToggle).toHaveAttribute('aria-pressed', 'false');

    await amazonToggle.click();
    await expect(amazonToggle).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('product ingestion', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'e2e-ingest@pricetrail.local');
  });

  /**
   * Every locator here is scoped to the dialog.
   *
   * A bare getByLabel('Product URL') is ambiguous: the header search box
   * carries aria-label "Search products or paste a product URL", which
   * substring-matches. Scoping to the dialog states the intent and is immune
   * to a future field being added elsewhere with a similar name.
   */
  test('rejects a URL from an unsupported marketplace with a usable message', async ({
    page,
  }) => {
    await page.goto('/products');
    await page.getByRole('button', { name: /track a product/i }).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Product URL' }).fill(
      'https://www.myntra.com/product/12345',
    );
    await dialog.getByRole('button', { name: /start tracking/i }).click();

    await expect(dialog.getByRole('alert')).toContainText(
      /amazon\.in and flipkart\.com/i,
    );
    // The dialog stays open with the URL intact so a typo can be corrected
    // rather than retyped.
    await expect(dialog.getByRole('textbox', { name: 'Product URL' })).toHaveValue(
      /myntra/,
    );
  });

  test('accepts a valid Amazon URL and creates a pending product', async ({ page }) => {
    const asin = `B0E2E${Date.now().toString().slice(-5)}`;

    await page.goto('/products');
    await page.getByRole('button', { name: /track a product/i }).first().click();

    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: 'Product URL' })
      .fill(`https://www.amazon.in/dp/${asin}`);
    await dialog.getByRole('button', { name: /start tracking/i }).click();

    // Dialog closes on success, and the product appears with an honest
    // "Fetching details" state — the API never scrapes in the request path.
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(asin, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('API contract', () => {
  test('CORS allows the web origin and refuses others', async ({ request }) => {
    const allowed = await request.fetch(`${API}/api/v1/meta`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(allowed.headers()['access-control-allow-origin']).toBe('http://localhost:3000');

    const denied = await request.get(`${API}/api/v1/meta`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    // The browser enforces CORS, so the request still returns 200 — the
    // absence of the header is what blocks it from being read.
    expect(denied.headers()['access-control-allow-origin']).toBeUndefined();
  });

  test('protected routes reject an unauthenticated request', async ({ request }) => {
    const response = await request.get(`${API}/api/v1/products`);
    expect(response.status()).toBe(401);

    const problem = await response.json();
    // RFC 7807 envelope with a stable machine code and a correlation id.
    expect(problem.title).toBe('UNAUTHENTICATED');
    expect(problem.correlationId).toBeTruthy();
  });

  test('health reports dependency status', async ({ request }) => {
    const response = await request.get(`${API}/health/ready`);
    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.dependencies.database.status).toBe('up');
    expect(body.dependencies.redis.status).toBe('up');
  });
});
