import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text', 'html'],
      /*
       * Enforced, not advisory. Coverage that is merely reported drifts
       * downward one un-tested branch at a time; a threshold that fails the
       * build is the only kind that holds.
       *
       * This package decides whether two listings are the same product. A
       * wrong answer here silently merges two products' price histories and
       * is not recoverable after the fact, so it carries the strictest bar in
       * the repo.
       */
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
