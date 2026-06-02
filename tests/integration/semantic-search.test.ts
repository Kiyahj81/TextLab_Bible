import { describe, expect, it } from "vitest";
import { getPassage, searchSemantic } from "@/lib/search";
import { parseReference } from "@/lib/references";

// Needs: lexical_fts + add_verse_embeddings migrations applied, full NT seeded,
// embeddings ingested (npm run embed:verses), and OPENAI_API_KEY set.
const enabled = Boolean(process.env.DATABASE_URL && process.env.OPENAI_API_KEY);

describe.skipIf(!enabled)("semantic search", () => {
  it("retrieves conceptually-related verses, all resolvable on the SBLGNT spine", async () => {
    const results = await searchSemantic({
      query: "what does Paul say about reconciliation between people and God",
      keywords: "reconciliation",
      limit: 10
    });
    expect(results.length).toBeGreaterThan(0);

    // The SBL-spine filter's real guarantee: every returned reference must actually
    // EXIST in SBLGNT. Verify independently of filterToSblSpine (which searchSemantic
    // itself uses) by resolving each reference against the Greek corpus via getPassage,
    // so a regression in the filter would fail this test rather than pass vacuously.
    for (const r of results) {
      const parsed = parseReference(r.reference);
      expect(parsed, `unparseable reference: ${r.reference}`).not.toBeNull();
      const sbl = await getPassage({
        corpus: "SBLGNT",
        book: parsed!.book,
        chapter: parsed!.chapter,
        verseStart: parsed!.verse
      });
      expect(sbl.references.length, `${r.reference} absent from SBLGNT spine`).toBeGreaterThan(0);
    }
  }, 30_000);

  it("returns [] for a blank query without an API call", async () => {
    expect(await searchSemantic({ query: "   " })).toEqual([]);
  });
});
