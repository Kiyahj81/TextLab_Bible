import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic"
    }
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    globals: false,
    pool: "threads",
    server: {
      deps: {
        // Force vitest to process next-auth and @auth/core through Vite so
        // the resolve.alias for "next/server" (which lacks the .js extension in
        // next-auth/lib/env.js) is applied. Without this, Node ESM can't
        // resolve the bare "next/server" specifier and throws MODULE_NOT_FOUND.
        inline: ["next-auth", "@auth/core"]
      }
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Coverage scope: server-side runtime logic only. This is what the
      // security/validation sprint is measured against. UI components,
      // pages, and the build-time CLI scripts are covered by the
      // acceptance test and are deferred from the line-coverage gate.
      include: ["app/api/**/*.ts", "lib/**/*.ts"],
      exclude: ["**/*.d.ts", "**/*.test.ts"],
      thresholds: {
        // Lines/statements gate is the primary security-sprint metric.
        // Branches and functions are tracked at lower thresholds for now;
        // the plan defers raising them until UI tests land.
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 65
      }
    }
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // next-auth/lib/env.js uses a bare "next/server" import that lacks the
      // .js extension required by Node ESM. Map it to the concrete file so
      // vitest resolves it when next-auth is inlined for processing.
      "next/server": fileURLToPath(new URL("./node_modules/next/server.js", import.meta.url))
    }
  }
});
