import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    verse: { findMany: vi.fn() }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { formatVectorLiteral, spineKey, filterToSblSpine } from "@/lib/search";

beforeEach(() => vi.clearAllMocks());

describe("formatVectorLiteral", () => {
  it("renders a number[] as a pgvector literal", () => {
    expect(formatVectorLiteral([0.1, 0.2, -0.3])).toBe("[0.1,0.2,-0.3]");
  });
});

describe("spineKey", () => {
  it("joins book|chapter|verse", () => {
    expect(spineKey("John", 1, 1)).toBe("John|1|1");
  });
});

describe("filterToSblSpine", () => {
  it("returns an empty set without touching the DB for empty input", async () => {
    const set = await filterToSblSpine([]);
    expect(set.size).toBe(0);
    expect(prismaMock.verse.findMany).not.toHaveBeenCalled();
  });

  it("returns the set of references that exist in SBLGNT", async () => {
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 1, verse: 1, book: { osisId: "John" } }
    ]);
    const set = await filterToSblSpine([
      { book: "John", chapter: 1, verse: 1 },
      { book: "John", chapter: 1, verse: 2 }
    ]);
    expect(set.has("John|1|1")).toBe(true);
    expect(set.has("John|1|2")).toBe(false);
  });
});
