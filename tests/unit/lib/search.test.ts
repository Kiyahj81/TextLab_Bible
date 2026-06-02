import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    token: { count: vi.fn(), findMany: vi.fn() },
    verse: { findMany: vi.fn(), findFirst: vi.fn() }
  }
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { searchLemma } from "@/lib/search";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchLemma verse hydration", () => {
  it("issues a single verse.findMany for all matching tokens", async () => {
    prismaMock.token.count.mockResolvedValue(2);
    prismaMock.token.findMany.mockResolvedValue([
      { id: "t1", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM",
        chapter: 1, verse: 1, book: { id: "b1", osisId: "John" }, corpus: { abbreviation: "SBLGNT" } },
      { id: "t2", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM",
        chapter: 1, verse: 14, book: { id: "b1", osisId: "John" }, corpus: { abbreviation: "SBLGNT" } }
    ]);
    prismaMock.verse.findMany.mockResolvedValue([
      { bookId: "b1", chapter: 1, verse: 1, text: "Ἐν ἀρχῇ ἦν ὁ λόγος", corpus: { abbreviation: "SBLGNT" } },
      { bookId: "b1", chapter: 1, verse: 14, text: "Καὶ ὁ λόγος σὰρξ ἐγένετο", corpus: { abbreviation: "SBLGNT" } }
    ]);

    const result = await searchLemma({ lemma: "λόγος" });

    expect(prismaMock.verse.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.verse.findMany).toHaveBeenCalledTimes(1);
    expect(result.results.map((r) => r.verseText)).toEqual([
      "Ἐν ἀρχῇ ἦν ὁ λόγος",
      "Καὶ ὁ λόγος σὰρξ ἐγένετο"
    ]);
  });
});

describe("searchLemma case-insensitivity", () => {
  it("matches the lemma case-insensitively so mixed-case variants (e.g. Διάβολος) are included", async () => {
    prismaMock.token.count.mockResolvedValue(0);
    prismaMock.token.findMany.mockResolvedValue([]);
    prismaMock.verse.findMany.mockResolvedValue([]);

    await searchLemma({ lemma: "διάβολος" });

    const expected = { equals: "διάβολος", mode: "insensitive" };
    expect(prismaMock.token.findMany.mock.calls[0][0].where.lemma).toEqual(expected);
    expect(prismaMock.token.count.mock.calls[0][0].where.lemma).toEqual(expected);
  });
});
