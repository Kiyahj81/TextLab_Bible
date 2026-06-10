import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    token: { count: vi.fn(), findMany: vi.fn() },
    verse: { findMany: vi.fn(), findFirst: vi.fn() }
  }
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { searchLemma, searchMorphology } from "@/lib/search";

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

describe("searchMorphology Robinson normalization", () => {
  it("normalizes a Robinson finite verb code to the stored MorphGNT person-first scheme before matching", async () => {
    prismaMock.token.count.mockResolvedValue(0);
    prismaMock.token.findMany.mockResolvedValue([]);
    prismaMock.verse.findMany.mockResolvedValue([]);

    await searchMorphology({ morphCode: "V-PAI-3S", matchMode: "exact" });

    // Robinson "V-PAI-3S" (person-last) must be normalized to stored "V-3PAI-S" (person-first).
    const expected = { equals: "V-3PAI-S", mode: "insensitive" };
    expect(prismaMock.token.findMany.mock.calls[0][0].where.morphCode).toEqual(expected);
    expect(prismaMock.token.count.mock.calls[0][0].where.morphCode).toEqual(expected);
  });

  it("passes through a stored-scheme MorphGNT code unchanged", async () => {
    prismaMock.token.count.mockResolvedValue(0);
    prismaMock.token.findMany.mockResolvedValue([]);
    prismaMock.verse.findMany.mockResolvedValue([]);

    await searchMorphology({ morphCode: "V-3PAI-S", matchMode: "exact" });

    const expected = { equals: "V-3PAI-S", mode: "insensitive" };
    expect(prismaMock.token.findMany.mock.calls[0][0].where.morphCode).toEqual(expected);
  });
});
