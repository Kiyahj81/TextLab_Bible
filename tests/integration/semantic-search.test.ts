import { describe, expect, it } from "vitest";
import { getPassage, searchSemantic } from "@/lib/search";
import { rerankCandidates } from "@/lib/search/rerank";
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

// Direct reranker proof. Only this test proves the real gateway/Voyage call
// succeeded; it does NOT go through searchSemantic's RRF fallback.
const rerankKeyed = Boolean(process.env.AI_GATEWAY_API_KEY);

describe.skipIf(!rerankKeyed)("rerankCandidates (live gateway)", () => {
  it("returns a non-null, input-derived, topN-bounded ranking", async () => {
    const candidates = [
      { reference: "John 1:1", text: "In the beginning was the Word, and the Word was with God." },
      { reference: "Gen 1:1", text: "In the beginning God created the heavens and the earth." },
      { reference: "Rom 5:8", text: "God shows his love for us in that Christ died for us." },
      { reference: "Ps 23:1", text: "The Lord is my shepherd; I shall not want." }
    ];
    const out = await rerankCandidates({
      query: "God's love demonstrated through Christ's death",
      candidates,
      topN: 2
    });
    expect(out, "rerank returned null — gateway/key/model misconfigured").not.toBeNull();
    expect(out!.length).toBeGreaterThan(0);
    expect(out!.length).toBeLessThanOrEqual(2);
    const inputRefs = new Set(candidates.map((c) => c.reference));
    for (const r of out!) expect(inputRefs.has(r.reference)).toBe(true);
  }, 30_000);
});

// Broader smoke test: rerank wired through searchSemantic. Treated as a smoke
// check (non-empty, on-spine), NOT as proof the external rerank call worked.
const rerankEnabled = Boolean(
  process.env.DATABASE_URL && process.env.OPENAI_API_KEY && process.env.AI_GATEWAY_API_KEY
);

describe.skipIf(!rerankEnabled)("semantic search with rerank", () => {
  it("returns reranked, on-spine results without error", async () => {
    const results = await searchSemantic({
      query: "what does Paul say about reconciliation between people and God",
      keywords: "reconciliation",
      limit: 5
    });
    expect(results.length).toBeGreaterThan(0);
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
});
