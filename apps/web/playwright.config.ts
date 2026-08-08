import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config.
 *
 * These tests exercise the real stack — Next, NestJS, Postgres, Redis — so
 * they need all of it running. They are deliberately NOT part of `pnpm test`:
 * unit tests must stay fast and runnable with nothing else up, and mixing the
 * two means the quick suite inherits the slow one's setup requirements.
 */
export default defineConfig({
  testDir: './e2e',
  // Serial locally: the seeded demo account is shared state, and parallel
  // workers mutating the same user produce flakes that look like real bugs.
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    // Artefacts only for failures — a passing run should leave nothing behind.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
