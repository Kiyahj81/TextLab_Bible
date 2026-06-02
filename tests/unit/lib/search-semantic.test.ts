import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    verse: { findMany: vi.fn() }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { getOpenAiMock } = vi.hoisted(() => ({ getOpenAiMock: vi.fn() }));
vi.mock("@/lib/ai/openaiClient", () => ({ getOpenAi: getOpenAiMock }));

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

import { searchSemantic } from "@/lib/search";

const fakeClient = (embedding: number[]) => ({
  embeddings: { create: vi.fn().mockResolvedValue({ data: [{ embedding }] }) }
});

describe("searchSemantic", () => {
  it("returns [] and skips all DB work when there is no OpenAI client", async () => {
    getOpenAiMock.mockReturnValue(null);
    const out = await searchSemantic({ query: "reconciliation" });
    expect(out).toEqual([]);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("runs vector KNN, drops WEB-only refs, and returns on-spine results", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    // vector KNN rows (one is WEB-only): keywords empty → FTS half skipped.
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { osisId: "Eph", chapter: 2, verse: 16, text: "and might reconcile both" },
      { osisId: "Acts", chapter: 8, verse: 37, text: "WEB-only verse" }
    ]);
    // SBL-spine filter: only Eph 2:16 exists in SBLGNT.
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 2, verse: 16, book: { osisId: "Eph" } }
    ]);

    const out = await searchSemantic({ query: "what does Paul say about reconciliation" });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1); // vector only; no keywords → no FTS
    expect(out.map((r) => r.reference)).toEqual(["Eph 2:16"]);
    expect(out[0].corpus).toBe("WEB");
  });

  it("also runs the FTS half when keywords are supplied", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ osisId: "Eph", chapter: 2, verse: 16, text: "reconcile" }]) // vector
      .mockResolvedValueOnce([{ osisId: "Eph", chapter: 2, verse: 16, text: "reconcile" }]); // FTS
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 2, verse: 16, book: { osisId: "Eph" } }
    ]);

    const out = await searchSemantic({ query: "reconciliation", keywords: "reconciliation" });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2); // vector + FTS
    expect(out.map((r) => r.reference)).toEqual(["Eph 2:16"]);
  });
});
