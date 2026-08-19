import { expect, test } from '@playwright/test';

/**
 * End-to-end coverage of the flows that only had manual curl checks before.
 *
 * Everything below runs against the real stack. The value here is not
 * duplicating unit assertions — it is catching the failures that only exist
 * BETWEEN the layers: a CORS header that blocks the browser, a chart that
 * renders zero canvases because a hook threw during hydration.
 *
 * There is no sign-in any more, so the whole authentication block is gone and
 * every test opens its page directly. The one it is worth naming: a test that
 * a signed-out visitor gets redirected would now pass for the wrong reason,
 * because there is nothing to redirect from.
 */

const API = process.env['E2E_API_URL'] ?? 'http://localhost:3001';

/**
 * The seeded iPhone, which carries ~1,550 price points.
 *
 * A fixed id from the seed rather than "click the first card in a list": there
 * is no list any more, and a test that navigated one would be asserting
 * against whatever had most recently been searched.
 */
const SEEDED_PRODUCT = '00000000-0000-4000-8000-000000000010';

test.describe('public access', () => {
  test('the dashboard opens with no sign-in', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('a product page is reachable directly', async ({ page }) => {
    await page.goto(`/products/${SEEDED_PRODUCT}`);
    await expect(page.getByRole('heading', { name: /iPhone 15 Pro/i })).toBeVisible();
  });
});

test.describe('price history chart', () => {
  test('renders the seeded product with a chart, and switches range', async ({ page }) => {
    await page.goto(`/products/${SEEDED_PRODUCT}`);

    await expect(page.getByRole('heading', { name: /iPhone 15 Pro/i })).toBeVisible();

    // Assert on the range selector rather than the panel's title text: roles
    // and accessible names are stable, whereas a getByText on a heading is
    // brittle against markup changes and can collide with other copy.
    await expect(page.getByRole('radio', { name: '7 days' })).toBeVisible({
      timeout: 20_000,
    });

    // ECharts renders to canvas; its presence is the proof the chart mounted
    // and the hook resolved rather than throwing during hydration.
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 20_000 });

    // Range switch must not blank the chart — keepPreviousData holds the old
    // render while the next range loads.
    await page.getByRole('radio', { name: '1 year' }).click();
    await expect(page.getByRole('radio', { name: '1 year' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(canvas).toBeVisible();
  });

  test('current prices are readable without hovering the chart', async ({ page }) => {
    // The table view was removed, so the direct labels are now the *only*
    // non-hover way to read a value. A tooltip must never be the sole channel
    // — a keyboard or touch user cannot produce one. If these labels ever
    // disappear, the chart becomes unreadable for them and this test fails.
    await page.goto(`/products/${SEEDED_PRODUCT}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });

    const label = page.locator('p.tabular-price').first();
    await expect(label).toBeVisible();
    await expect(label).toContainText('₹');
  });

  test('platform toggles hide and restore a series', async ({ page }) => {
    await page.goto(`/products/${SEEDED_PRODUCT}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });

    const amazonToggle = page.getByRole('button', { name: /Amazon/ }).first();
    await amazonToggle.click();
    await expect(amazonToggle).toHaveAttribute('aria-pressed', 'false');

    await amazonToggle.click();
    await expect(amazonToggle).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('product search', () => {
  /**
   * The dashboard's search panel replaced a modal dialog.
   *
   * These used to open a dialog and scope every locator to it. With the search
   * inline on the page, the ambiguity that scoping solved is gone — the header
   * search is hidden on /dashboard precisely so there is only ever one search
   * field on this screen.
   */
  test('rejects a URL from an unsupported marketplace with a usable message', async ({
    page,
  }) => {
    await page.goto('/dashboard');

    await page
      .getByRole('textbox', { name: /product URL/i })
      .fill('https://www.myntra.com/product/12345');
    await page.getByRole('button', { name: /^search$/i }).click();

    // Matched by TEXT, not by role. Next renders a permanently-present, empty
    // route announcer with role="alert", so getByRole('alert') resolves to two
    // elements here and fails strict mode — and reads as the error being
    // absent when it is not.
    await expect(page.getByText(/amazon\.in and flipkart\.com/i)).toBeVisible();

    // The URL survives, so a typo can be corrected rather than retyped.
    await expect(page.getByRole('textbox', { name: /product URL/i })).toHaveValue(/myntra/);
  });

  test('accepts a valid Amazon URL and navigates to its history', async ({ page }) => {
    const asin = `B0E2E${Date.now().toString().slice(-5)}`;

    await page.goto('/dashboard');
    await page
      .getByRole('textbox', { name: /product URL/i })
      .fill(`https://www.amazon.in/dp/${asin}`);
    await page.getByRole('button', { name: /^search$/i }).click();

    // Searching navigates to the product's own page rather than closing onto a
    // list — there is no list. It arrives PENDING, because the API never
    // scrapes inside the request path.
    await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}/, { timeout: 20_000 });
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

  test('product routes are public and need no credentials', async ({ request }) => {
    // The inverse of the assertion this replaced. Reads used to 401 without a
    // bearer token; there are no accounts now, so an anonymous request must
    // succeed — and if auth were ever reintroduced by accident, this fails.
    const response = await request.get(`${API}/api/v1/products`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.items)).toBe(true);
  });

  test('errors still use the RFC 7807 envelope', async ({ request }) => {
    // Worth keeping separately: removing the guards must not have removed the
    // error contract with them.
    const response = await request.get(
      `${API}/api/v1/products/00000000-0000-4000-8000-00000000dead`,
    );
    expect(response.status()).toBe(404);

    const problem = await response.json();
    expect(problem.title).toBe('NOT_FOUND');
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
