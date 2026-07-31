import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    // Integration tests share one Postgres connection pool and truncate
    // tables between tests — run files serially to avoid cross-test
    // interference on shared rows (e.g. mail_usage, admin_config).
    fileParallelism: false,
    testTimeout: 15000,
  },
});
