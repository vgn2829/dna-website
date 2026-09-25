import { defineConfig } from 'vitest/config';

// Frontend unit tests. Deliberately minimal and deliberately node-env:
// this config exists for PURE logic only (string/label helpers), not for
// rendering components. There is no jsdom and no testing-library here on
// purpose — component tests over tldraw's editor context would be brittle
// and would duplicate what the two-client browser QA already verifies for
// real. See src/app/components/hooks/presenceLabels.ts's own comment.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
});
