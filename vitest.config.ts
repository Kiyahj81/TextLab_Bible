import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: {
    jsx: "automatic"
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["tests/unit/components/**", "jsdom"]],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    globals: false,
    pool: "threads"
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url))
    }
  }
});
