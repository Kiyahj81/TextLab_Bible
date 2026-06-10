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
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(2) }])
      .mockResolvedValueOnce([
        { corpus: "SBLGNT", osisId: "John", chapter: 1, verse: 1, text: "Ἐν ἀρχῇ ἦν ὁ λόγος" },
        { corpus: "SBLGNT", osisId: "John", chapter: 1, verse: 14, text: "Καὶ ὁ λόγος σὰρξ ἐγένετο" }
      ]);
    // filterToSblSpine: both verses exist on the SBLGNT spine
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 1, verse: 1, book: { osisId: "John" } },
      { chapter: 1, verse: 14, book: { osisId: "John" } }
    ]);

    const out = await searchKeyword({ query: "λόγος", corpus: "SBLGNT" });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(out.pagination.total).toBe(2);
    expect(out.results).toEqual([
      { corpus: "SBLGNT", reference: "John 1:1", text: "Ἐν ἀρχῇ ἦν ὁ λόγος", onSpine: true },
      { corpus: "SBLGNT", reference: "John 1:14", text: "Καὶ ὁ λόγος σὰρξ ἐγένετο", onSpine: true }
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
        { corpus: "WEB", osisId: "Acts", chapter: 8, verse: 36, text: "See, here is water..." },
        { corpus: "WEB", osisId: "Acts", chapter: 8, verse: 37, text: "Philip said..." }
      ]);
    // Spine query only returns Acts 8:36 (Acts 8:37 is WEB-only)
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 8, verse: 36, book: { osisId: "Acts" } }
    ]);

    const out = await searchKeyword({ query: "water" });

    expect(out.results[0]).toMatchObject({ reference: "Acts 8:36", onSpine: true });
    expect(out.results[1]).toMatchObject({ reference: "Acts 8:37", onSpine: false });
  });
});

// Prisma.sql tagged templates pass a { strings, values } object (or an array of
// SQL fragments). Flatten whatever the mock received into a lowercased string so
// the assertions above can look for SQL keywords regardless of fragment shape.
function sqlTextFrom(call: unknown[] | undefined): string {
  if (!call) return "";
  return JSON.stringify(call).toLowerCase();
}
