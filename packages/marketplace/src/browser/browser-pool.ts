import type { Browser, BrowserContext, Page } from 'playwright';

/**
 * Shared Chromium instance with pooled, isolated contexts.
 *
 * Two costs drive this design:
 *
 *  1. Launching Chromium takes 1-3 seconds and ~250 MB. Doing that per fetch
 *     makes a 50k-listing sweep impossible on any sane hardware, so ONE
 *     browser process is launched lazily and reused.
 *
 *  2. Reusing a single *context* across fetches would share cookies,
 *     localStorage and cache between them — so one captcha cookie taints every
 *     subsequent request, and the session looks increasingly like a bot. Each
 *     fetch therefore gets a fresh BrowserContext (cheap, ~10 ms) and disposes
 *     it afterwards.
 *
 * Browser = expensive and shared. Context = cheap and disposable.
 */
export interface BrowserPoolOptions {
  headless?: boolean;
  maxContexts?: number;
  proxy?: { server: string; username?: string; password?: string };
}

const DESKTOP_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

export class BrowserPool {
  private browser: Browser | undefined;
  private launching: Promise<Browser> | undefined;
  private activeContexts = 0;

  constructor(private readonly options: BrowserPoolOptions = {}) {}

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;

    // Concurrent callers must not each launch a browser. Caching the in-flight
    // promise makes the first caller launch and the rest await the same one.
    this.launching ??= this.launch();

    try {
      this.browser = await this.launching;
      return this.browser;
    } finally {
      this.launching = undefined;
    }
  }

  private async launch(): Promise<Browser> {
    // Imported lazily so this package stays usable — and testable — on a
    // machine where `playwright install` has never been run. Only code paths
    // that actually need a browser pay for it.
    const { chromium } = await import('playwright');

    return chromium.launch({
      headless: this.options.headless ?? true,
      args: [
        // Removes the `navigator.webdriver === true` giveaway.
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-gpu',
      ],
      proxy: this.options.proxy,
    });
  }

  /**
   * Run `work` against a fresh page, then dispose the context.
   *
   * The callback form is deliberate: handing out a Page and trusting callers
   * to close it leaks a context on every early return or thrown error, and a
   * leaked context is ~40 MB that never comes back.
   */
  async withPage<T>(work: (page: Page) => Promise<T>): Promise<T> {
    const max = this.options.maxContexts ?? 4;
    if (this.activeContexts >= max) {
      throw new Error(`Browser pool exhausted (${max} concurrent contexts)`);
    }

    const browser = await this.getBrowser();
    this.activeContexts++;

    let context: BrowserContext | undefined;
    try {
      const viewport =
        DESKTOP_VIEWPORTS[Math.floor(Math.random() * DESKTOP_VIEWPORTS.length)] ??
        DESKTOP_VIEWPORTS[0]!;

      context = await browser.newContext({
        viewport,
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        extraHTTPHeaders: { 'Accept-Language': 'en-IN,en;q=0.9' },
      });

      // Product pages need HTML and script; images, fonts and media are pure
      // bandwidth for our purposes. Blocking them cuts page weight by most of
      // its size and shortens every fetch.
      await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (type === 'image' || type === 'font' || type === 'media') {
          return route.abort();
        }
        return route.continue();
      });

      const page = await context.newPage();
      return await work(page);
    } finally {
      await context?.close().catch(() => undefined);
      this.activeContexts--;
    }
  }

  async dispose(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = undefined;
  }

  get stats(): { launched: boolean; activeContexts: number } {
    return {
      launched: this.browser?.isConnected() ?? false,
      activeContexts: this.activeContexts,
    };
  }
}
