import { defineConfig } from "vitest/config";

// Pure helpers use Node by default. Focused component/security tests opt into
// jsdom with a per-file environment directive; no tldraw editor is mounted.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
