import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    verse: { findMany: vi.fn() }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { getPassageNeighbors } from "@/lib/search";

beforeEach(() => {
  vi.clearAllMocks();
});

function chapterRows(chapters: number[]) {
  return chapters.map((chapter) => ({ chapter }));
}

describe("getPassageNeighbors", () => {
  it("returns both prev and next for a middle chapter", async () => {
    prismaMock.verse.findMany.mockResolvedValue(chapterRows([1, 2, 3, 4, 5]));
    const result = await getPassageNeighbors("John", 3);
    expect(result.prev).toEqual({ book: "John", chapter: 2 });
    expect(result.next).toEqual({ book: "John", chapter: 4 });
  });

  it("returns null prev at the first chapter", async () => {
    prismaMock.verse.findMany.mockResolvedValue(chapterRows([1, 2, 3]));
    const result = await getPassageNeighbors("John", 1);
    expect(result.prev).toBeNull();
    expect(result.next).toEqual({ book: "John", chapter: 2 });
  });

  it("returns null next at the last chapter", async () => {
    prismaMock.verse.findMany.mockResolvedValue(chapterRows([1, 2, 3]));
    const result = await getPassageNeighbors("John", 3);
    expect(result.prev).toEqual({ book: "John", chapter: 2 });
    expect(result.next).toBeNull();
  });

  it("returns both null when the requested chapter is unknown", async () => {
    prismaMock.verse.findMany.mockResolvedValue(chapterRows([1, 2, 3]));
    const result = await getPassageNeighbors("John", 99);
    expect(result.prev).toBeNull();
    expect(result.next).toBeNull();
  });

  it("returns both null when the book has no chapters", async () => {
    prismaMock.verse.findMany.mockResolvedValue([]);
    const result = await getPassageNeighbors("Phlm", 1);
    expect(result.prev).toBeNull();
    expect(result.next).toBeNull();
  });
});
