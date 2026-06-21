import { afterEach } from "vitest";

// Shared unit-test setup.
//
// vitest runs with `globals: false` and a default `node` environment;
// component tests opt into jsdom per-file via `// @vitest-environment jsdom`.
// Because globals are off, @testing-library/react's built-in auto-cleanup —
// which only registers itself when `afterEach` is exposed as a global — never
// runs, so rendered DOM leaks between tests in the same file (a second
// `render()` of the same component makes `screen.getByRole` throw
// "found multiple elements").
//
// Register cleanup explicitly here so component tests don't have to remember
// it. The DOM guard keeps the (many) node-environment tests from importing
// @testing-library/react at all.
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
