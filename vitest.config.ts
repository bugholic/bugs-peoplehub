import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // DB-backed tests (skipped without DATABASE_URL) make dozens of sequential round trips
    // to a remote Postgres (Neon); 5s, the default, is too tight under network latency.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

