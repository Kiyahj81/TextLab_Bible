import { describe, expect, it } from "vitest";
import { searchSemantic } from "@/lib/search";

// Needs: lexical_fts + add_verse_embeddings migrations applied, full NT seeded,
// embeddings ingested (npm run embed:verses), and OPENAI_API_KEY set.
const enabled = Boolean(process.env.DATABASE_URL && process.env.OPENAI_API_KEY);

describe.skipIf(!enabled)("semantic search", () => {
  it("retrieves conceptually-related verses for a topical query", async () => {
    const results = await searchSemantic({
      query: "what does Paul say about reconciliation between people and God",
      keywords: "reconciliation",
      limit: 10
    });
    expect(results.length).toBeGreaterThan(0);
    // Every returned reference must be on the SBLGNT spine (filter guarantee).
    expect(results.every((r) => r.corpus === "WEB")).toBe(true);
  }, 30_000);

  it("returns [] for a blank query without an API call", async () => {
    expect(await searchSemantic({ query: "   " })).toEqual([]);
  });
});
