import { describe, expect, it } from "vitest";
import { runDeterministic } from "@/eval/runner";

// Smoke test for the eval runner against the real corpus. Skips when no DB is
// configured. Requires the full NT corpus seeded on the target Neon branch
// (same seeding requirement as fts-search.test.ts).
// `npm run test:integration` loads .env.test, pointing DATABASE_URL at the
// integration-acceptance branch.
const enabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("eval runner (integration)", () => {
  it(
    "runs an exact-verse question end-to-end and produces a well-formed RunResult",
    async () => {
      const result = await runDeterministic({
        id: "smoke-john-3-16",
        question: "What does John 3:16 say?",
        queryType: "exact-verse",
        goldenReferences: ["John 3:16"]
      });
      expect(result.retrievedReferences).toContain("John 3:16");
      expect(result.recall).toBe(1);
      expect(result.citationsResolve).toBe(true);
      expect(result.mode).toBe("deterministic");
      expect(typeof result.precision).toBe("number");
    },
    30_000
  );
});
