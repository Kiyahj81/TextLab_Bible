import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Separate config so unit tests stay fast. Integration tests hit a real
// PostgreSQL database via Prisma and skip themselves at runtime when
// DATABASE_URL is not reachable.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.{ts,tsx}"],
    globals: false,
    pool: "threads",
    // Sequential execution to keep DB state predictable across files.
    fileParallelism: false,
    testTimeout: 30_000
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url))
    }
  }
});
