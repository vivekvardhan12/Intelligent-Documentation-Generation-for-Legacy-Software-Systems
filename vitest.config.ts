/**
 * Vitest configuration.
 *
 * The suites target the PURE modules — statistics, metrics, token accounting,
 * prompt packing and concurrency — where the project's actual algorithms live
 * and where a silent regression would corrupt experimental results without
 * anyone noticing. A `node` environment is sufficient because none of these
 * modules touch the DOM.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Explicit imports from 'vitest' are used instead of globals, so that test
    // files typecheck under the same tsconfig as the application.
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/utils/**', 'src/config/**'],
      reporter: ['text', 'html'],
    },
  },
});
