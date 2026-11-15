import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The slowest sim tests sail a boat for minutes of game time; on a busy machine they need more than the default five seconds.
    testTimeout: 30000,
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
  },
});
