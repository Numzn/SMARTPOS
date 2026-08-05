const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 15000,
    hookTimeout: 30000,
    // Integration tests share one Postgres connection pool and mutate shared
    // rows (products/inventory) — run test files serially to avoid cross-file
    // interference, same reason validate-system.js runs as one sequential script.
    fileParallelism: false,
  },
});
