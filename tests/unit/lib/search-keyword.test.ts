import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    verse: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() }
  }
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { searchKeyword } from "@/lib/search";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchKeyword FTS", () => {
  it("returns an empty result for a blank query without touching the DB", async () => {
    const out = await searchKeyword({ query: "   " });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(out.results).toEqual([]);
    expect(out.pagination).toEqual({ page: 1, pageSize: 25, total: 0, pageCount: 0 });
  });

  it("issues a count query and a rows query for a real query", async () => {
    const S = String.fromCharCode(0xe000);
    const E = String.fromCharCode(0xe001);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(2) }])
      .mockResolvedValueOnce([
        { corpus: "SBLGNT", osisId: "John", chapter: 1, verse: 1, text: "Ἐν ἀρχῇ ἦν ὁ λόγος", headline: `Ἐν ἀρχῇ ἦν ὁ ${S}λόγος${E}` },
        { corpus: "SBLGNT", osisId: "John", chapter: 1, verse: 14, text: "Καὶ ὁ λόγος σὰρξ ἐγένετο", headline: `Καὶ ὁ ${S}λόγος${E} σὰρξ ἐγένετο` }
      ]);
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 1, verse: 1, book: { osisId: "John" } },
      { chapter: 1, verse: 14, book: { osisId: "John" } }
    ]);

    const out = await searchKeyword({ query: "λόγος", corpus: "SBLGNT" });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(out.pagination.total).toBe(2);
    expect(out.results).toEqual([
      { corpus: "SBLGNT", reference: "John 1:1", text: "Ἐν ἀρχῇ ἦν ὁ λόγος", onSpine: true,
        highlightSegments: [
          { kind: "text", value: "Ἐν ἀρχῇ ἦν ὁ " },
          { kind: "match", value: "λόγος" }
        ] },
      { corpus: "SBLGNT", reference: "John 1:14", text: "Καὶ ὁ λόγος σὰρξ ἐγένετο", onSpine: true,
        highlightSegments: [
          { kind: "text", value: "Καὶ ὁ " },
          { kind: "match", value: "λόγος" },
          { kind: "text", value: " σὰρξ ἐγένετο" }
        ] }
    ]);
  });

  it("uses ts_rank ordering SQL when orderBy is rank, canonical otherwise", async () => {
    // rank branch: count call returns count shape; rows call returns empty rows
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(0) }])
      .mockResolvedValueOnce([]);
    await searchKeyword({ query: "grace", orderBy: "rank" });
    const rankSql = sqlTextFrom(prismaMock.$queryRaw.mock.calls.at(-1));
    expect(rankSql).toContain("ts_rank");

    vi.clearAllMocks();
    // canonical branch: count call returns count shape; rows call returns empty rows
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(0) }])
      .mockResolvedValueOnce([]);
    await searchKeyword({ query: "grace", orderBy: "canonical" });
    const canonicalSql = sqlTextFrom(prismaMock.$queryRaw.mock.calls.at(-1));
    expect(canonicalSql).not.toContain("ts_rank");
    expect(canonicalSql).toContain("order");
  });

  it("propagates book and chapter filters into the SQL", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(0) }])
      .mockResolvedValueOnce([]);

    await searchKeyword({ query: "grace", book: "John", chapter: 3 });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    const sql = sqlTextFrom(prismaMock.$queryRaw.mock.calls[0]);
    expect(sql).toContain("osisid");
    expect(sql).toContain("chapter");
  });

  it("annotates onSpine true for rows the spine query returns and false for those it does not", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(2) }])
      .mockResolvedValueOnce([
        { corpus: "WEB", osisId: "Acts", chapter: 8, verse: 36, text: "See, here is water...", headline: "See, here is water..." },
        { corpus: "WEB", osisId: "Acts", chapter: 8, verse: 37, text: "Philip said...", headline: "Philip said..." }
      ]);
    // Spine query only returns Acts 8:36 (Acts 8:37 is WEB-only)
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 8, verse: 36, book: { osisId: "Acts" } }
    ]);

    const out = await searchKeyword({ query: "water" });

    expect(out.results[0]).toMatchObject({ reference: "Acts 8:36", onSpine: true });
    expect(out.results[1]).toMatchObject({ reference: "Acts 8:37", onSpine: false });
  });

  it("uses one language-routed predicate carrying both configs (no-corpus default)", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(0) }])
      .mockResolvedValueOnce([]);
    await searchKeyword({ query: "love" });
    const sql = sqlTextFrom(prismaMock.$queryRaw.mock.calls[0]);
    expect(sql).toContain("bible_english");
    expect(sql).toContain("textsearchen");
    expect(sql).toContain("bible_simple");
    expect(sql).toContain("language");
  });

  it("narrows by abbreviation when an explicit corpus is given", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(0) }])
      .mockResolvedValueOnce([]);
    await searchKeyword({ query: "love", corpus: "WEB" });
    const sql = sqlTextFrom(prismaMock.$queryRaw.mock.calls[0]);
    expect(sql).toContain("abbreviation");
    // Assert the *bound* corpus literal — a quoted "web" in the serialized
    // values — not a bare `web`, which also matches `websearch_to_tsquery` and
    // would pass even if the `c."abbreviation" = ${corpus}` filter regressed.
    expect(sql).toContain('"web"');
    expect(sql).toContain("bible_english");
  });

  it("parses the per-row headline into highlightSegments", async () => {
    const S = String.fromCharCode(0xe000);
    const E = String.fromCharCode(0xe001);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(1) }])
      .mockResolvedValueOnce([
        {
          corpus: "WEB",
          osisId: "John",
          chapter: 3,
          verse: 16,
          text: "For God so loved the world",
          headline: `For God so ${S}loved${E} the world`
        }
      ]);
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 3, verse: 16, book: { osisId: "John" } }
    ]);

    const out = await searchKeyword({ query: "love", corpus: "WEB" });
    expect(out.results[0].highlightSegments).toEqual([
      { kind: "text", value: "For God so " },
      { kind: "match", value: "loved" },
      { kind: "text", value: " the world" }
    ]);
  });
});

describe("searchKeyword withEnglish", () => {
  it("attaches englishText to SBLGNT hits and omits it for WEB hits when withEnglish is true", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(2) }])
      .mockResolvedValueOnce([
        { corpus: "SBLGNT", osisId: "John", chapter: 1, verse: 1, text: "Ἐν ἀρχῇ ἦν ὁ λόγος", headline: "Ἐν ἀρχῇ ἦν ὁ λόγος" },
        { corpus: "WEB", osisId: "John", chapter: 1, verse: 1, text: "In the beginning was the Word", headline: "In the beginning was the Word" }
      ]);
    // filterToSblSpine call
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 1, verse: 1, book: { osisId: "John" } }
    ]);
    // WEB English lookup for SBLGNT rows only
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { bookId: undefined, chapter: 1, verse: 1, text: "In the beginning was the Word",
        book: { osisId: "John" }, corpus: { abbreviation: "WEB" } }
    ]);

    const out = await searchKeyword({ query: "λόγος", withEnglish: true });

    // Two verse.findMany calls: one for spine, one for WEB English
    expect(prismaMock.verse.findMany).toHaveBeenCalledTimes(2);
    const sblgntHit = out.results.find((r) => r.corpus === "SBLGNT");
    const webHit = out.results.find((r) => r.corpus === "WEB");
    expect(sblgntHit?.englishText).toBe("In the beginning was the Word");
    expect(webHit?.englishText).toBeUndefined();
  });

  it("does not issue a WEB verse lookup when withEnglish is absent", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(1) }])
      .mockResolvedValueOnce([
        { corpus: "SBLGNT", osisId: "John", chapter: 1, verse: 1, text: "Ἐν ἀρχῇ ἦν ὁ λόγος", headline: "Ἐν ἀρχῇ ἦν ὁ λόγος" }
      ]);
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 1, verse: 1, book: { osisId: "John" } }
    ]);

    const out = await searchKeyword({ query: "λόγος" });

    // Only one verse.findMany call (spine check); no WEB lookup
    expect(prismaMock.verse.findMany).toHaveBeenCalledTimes(1);
    expect("englishText" in out.results[0]).toBe(false);
  });
});

// Prisma.sql tagged templates pass a { strings, values } object (or an array of
// SQL fragments). Flatten whatever the mock received into a lowercased string so
// the assertions above can look for SQL keywords regardless of fragment shape.
function sqlTextFrom(call: unknown[] | undefined): string {
  if (!call) return "";
  return JSON.stringify(call).toLowerCase();
}
