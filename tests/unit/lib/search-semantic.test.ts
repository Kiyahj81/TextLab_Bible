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

const { rerankCandidatesMock } = vi.hoisted(() => ({ rerankCandidatesMock: vi.fn() }));
vi.mock("@/lib/search/rerank", () => ({ rerankCandidates: rerankCandidatesMock }));

import { EMBEDDING_MODEL, embeddingTextHash, formatVectorLiteral, spineKey, filterToSblSpine, embedQuery } from "@/lib/search";

beforeEach(() => vi.resetAllMocks());

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

describe("embeddingTextHash", () => {
  it("normalizes surrounding whitespace and changes when verse text changes", () => {
    expect(embeddingTextHash(" In the beginning ")).toBe(embeddingTextHash("In the beginning"));
    expect(embeddingTextHash("In the beginning")).not.toBe(embeddingTextHash("In the end"));
  });
});

import { searchSemantic, searchSemanticDetailed } from "@/lib/search";

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

  it("uses bible_english/textSearchEn for the WEB keyword FTS leg", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ osisId: "John", chapter: 1, verse: 1, text: "In the beginning" }]) // vector
      .mockResolvedValueOnce([{ osisId: "Eph", chapter: 2, verse: 16, text: "reconcile" }]); // FTS
    prismaMock.verse.findMany.mockResolvedValueOnce([]); // filterToSblSpine
    rerankCandidatesMock.mockResolvedValueOnce(null);

    await searchSemantic({ query: "reconciliation", keywords: "reconciliation" });

    const ftsSql = JSON.stringify(prismaMock.$queryRaw.mock.calls[1]).toLowerCase();
    expect(ftsSql).toContain("bible_english");
    expect(ftsSql).toContain("textsearchen");
    expect(ftsSql).not.toContain("bible_simple");
  });

  it("filters vector KNN rows to the current embedding model", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    prismaMock.verse.findMany.mockResolvedValueOnce([]);

    await searchSemantic({ query: "reconciliation" });

    const sql = JSON.stringify(prismaMock.$queryRaw.mock.calls[0]);
    expect(sql).toContain("model");
    expect(sql).toContain(EMBEDDING_MODEL);
  });

  it("applies a chapter-equality filter to the SQL only when a chapter is provided", async () => {
    // matches the filter clause v."chapter" = $n, but NOT the SELECT's v."chapter" AS chapter
    const chapterFilter = /chapter\\?"?\s*=/i;

    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.verse.findMany.mockResolvedValue([]);
    await searchSemantic({ query: "love", book: "John", chapter: 3 });
    expect(JSON.stringify(prismaMock.$queryRaw.mock.calls[0])).toMatch(chapterFilter);

    vi.resetAllMocks();
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.verse.findMany.mockResolvedValue([]);
    await searchSemantic({ query: "love", book: "John" });
    expect(JSON.stringify(prismaMock.$queryRaw.mock.calls[0])).not.toMatch(chapterFilter);
  });

  it("returns rerank order when rerank succeeds", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { osisId: "Eph", chapter: 2, verse: 16, text: "reconcile both" },
      { osisId: "Rom", chapter: 5, verse: 10, text: "we were reconciled" }
    ]);
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 2, verse: 16, book: { osisId: "Eph" } },
      { chapter: 5, verse: 10, book: { osisId: "Rom" } }
    ]);
    // rerank flips the RRF order
    rerankCandidatesMock.mockResolvedValueOnce([
      { reference: "Rom 5:10", text: "we were reconciled" },
      { reference: "Eph 2:16", text: "reconcile both" }
    ]);

    const out = await searchSemantic({ query: "reconciliation" });

    expect(out.map((r) => r.reference)).toEqual(["Rom 5:10", "Eph 2:16"]);
    // rerank received on-spine candidates with WEB text
    const passed = rerankCandidatesMock.mock.calls[0][0];
    expect(passed.candidates.map((c: { reference: string }) => c.reference)).toEqual([
      "Eph 2:16",
      "Rom 5:10"
    ]);
    expect(out.every((r) => r.corpus === "WEB")).toBe(true);
  });

  it("reports applied rerank metadata when rerank succeeds", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { osisId: "Eph", chapter: 2, verse: 16, text: "reconcile both" },
      { osisId: "Rom", chapter: 5, verse: 10, text: "we were reconciled" }
    ]);
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 2, verse: 16, book: { osisId: "Eph" } },
      { chapter: 5, verse: 10, book: { osisId: "Rom" } }
    ]);
    rerankCandidatesMock.mockResolvedValueOnce([
      { reference: "Rom 5:10", text: "we were reconciled" },
      { reference: "Eph 2:16", text: "reconcile both" }
    ]);

    const out = await searchSemanticDetailed({ query: "reconciliation", limit: 5 });

    expect(out.results.map((r) => r.reference)).toEqual(["Rom 5:10", "Eph 2:16"]);
    expect(out.rerank).toEqual({ status: "applied", candidateCount: 2 });
  });

  it("falls back to RRF order (byte-identical) when rerank returns null", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { osisId: "Eph", chapter: 2, verse: 16, text: "reconcile both" },
      { osisId: "Rom", chapter: 5, verse: 10, text: "we were reconciled" }
    ]);
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 2, verse: 16, book: { osisId: "Eph" } },
      { chapter: 5, verse: 10, book: { osisId: "Rom" } }
    ]);
    rerankCandidatesMock.mockResolvedValueOnce(null);

    const out = await searchSemantic({ query: "reconciliation" });
    // RRF order preserved (both at rank 0 of the single vector list → input order)
    expect(out.map((r) => r.reference)).toEqual(["Eph 2:16", "Rom 5:10"]);
  });

  it("reports fallback rerank metadata when rerank returns null", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { osisId: "Eph", chapter: 2, verse: 16, text: "reconcile both" },
      { osisId: "Rom", chapter: 5, verse: 10, text: "we were reconciled" }
    ]);
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 2, verse: 16, book: { osisId: "Eph" } },
      { chapter: 5, verse: 10, book: { osisId: "Rom" } }
    ]);
    rerankCandidatesMock.mockResolvedValueOnce(null);

    const out = await searchSemanticDetailed({ query: "reconciliation", limit: 5 });

    expect(out.results.map((r) => r.reference)).toEqual(["Eph 2:16", "Rom 5:10"]);
    expect(out.rerank).toEqual({ status: "fallback", candidateCount: 2 });
  });

  it("does not call rerank when rerank:false is passed", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { osisId: "Eph", chapter: 2, verse: 16, text: "reconcile both" }
    ]);
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 2, verse: 16, book: { osisId: "Eph" } }
    ]);

    const out = await searchSemantic({ query: "reconciliation", rerank: false });
    expect(rerankCandidatesMock).not.toHaveBeenCalled();
    expect(out.map((r) => r.reference)).toEqual(["Eph 2:16"]);
  });

  it("reports disabled rerank metadata when rerank:false is passed", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { osisId: "Eph", chapter: 2, verse: 16, text: "reconcile both" }
    ]);
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 2, verse: 16, book: { osisId: "Eph" } }
    ]);

    const out = await searchSemanticDetailed({ query: "reconciliation", rerank: false });

    expect(rerankCandidatesMock).not.toHaveBeenCalled();
    expect(out.results.map((r) => r.reference)).toEqual(["Eph 2:16"]);
    expect(out.rerank).toEqual({ status: "disabled", candidateCount: 1 });
  });

  it("caps the rerank candidate pool to 30 (top-30 → top-5)", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    // 40 distinct on-spine vector rows → onSpine > 30
    const rows = Array.from({ length: 40 }, (_, i) => ({
      osisId: "John", chapter: 1, verse: i + 1, text: `verse ${i + 1}`
    }));
    prismaMock.$queryRaw.mockResolvedValueOnce(rows);
    prismaMock.verse.findMany.mockResolvedValueOnce(
      rows.map((r) => ({ chapter: r.chapter, verse: r.verse, book: { osisId: r.osisId } }))
    );
    rerankCandidatesMock.mockResolvedValueOnce(null); // fallback path; we only assert the input cap

    await searchSemantic({ query: "love", limit: 5 });

    expect(rerankCandidatesMock.mock.calls[0][0].candidates.length).toBe(30);
    expect(rerankCandidatesMock.mock.calls[0][0].topN).toBe(5);
  });
});

describe("embedQuery", () => {
  it("returns null when the embeddings API rejects (timeout / transient error)", async () => {
    // Regression (#51): a rejected embeddings.create() bubbled out of embedQuery
    // before searchSemanticDetailed could return its disabled fallback.
    getOpenAiMock.mockReturnValue({
      embeddings: { create: vi.fn().mockRejectedValue(new Error("ETIMEDOUT")) }
    });
    await expect(embedQuery("reconciliation")).resolves.toBeNull();
  });

  it("returns the embedding vector on success", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    await expect(embedQuery("reconciliation")).resolves.toEqual([0.1, 0.2, 0.3]);
  });

  it("returns null without calling the API when there is no client", async () => {
    getOpenAiMock.mockReturnValue(null);
    await expect(embedQuery("reconciliation")).resolves.toBeNull();
  });
});
