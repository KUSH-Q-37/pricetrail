import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Parsers, normalizers and the boundary schema — the code that decides
      // what gets written into permanent price history.
      include: [
        'src/shared/**/*.ts',
        'src/amazon/amazon.parser.ts',
        'src/flipkart/flipkart.parser.ts',
        'src/flipkart/json-ld.ts',
        'src/product-data.schema.ts',
        'src/url-parser.ts',
      ],
      reporter: ['text', 'html'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
