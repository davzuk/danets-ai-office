import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // The default pool (forks/threads) fails to wire `runner.config` on
    // Node 24 + vitest 4.1.10 + vite 8, so every suite throws "Cannot read
    // properties of undefined (reading 'config')". vmThreads runs in-process
    // and collects correctly.
    pool: "vmThreads",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
