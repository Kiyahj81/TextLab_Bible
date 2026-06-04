import { describe, expect, it, vi, beforeEach } from "vitest";

const { rerankMock } = vi.hoisted(() => ({ rerankMock: vi.fn() }));
vi.mock("ai", () => ({ rerank: rerankMock }));

import { RERANK_MODEL, rerankCandidates } from "@/lib/search/rerank";

const CANDS = [
  { reference: "John 1:1", text: "In the beginning was the Word" },
  { reference: "Eph 2:16", text: "and might reconcile both to God" },
  { reference: "Rom 5:10", text: "we were reconciled to God" }
];

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_GATEWAY_API_KEY;
});

describe("rerankCandidates", () => {
  it("returns null and makes no network call when AI_GATEWAY_API_KEY is unset", async () => {
    const out = await rerankCandidates({ query: "reconciliation", candidates: CANDS });
    expect(out).toBeNull();
    expect(rerankMock).not.toHaveBeenCalled();
  });

  it("returns null for empty candidates without a network call", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    const out = await rerankCandidates({ query: "reconciliation", candidates: [] });
    expect(out).toBeNull();
    expect(rerankMock).not.toHaveBeenCalled();
  });

  it("maps ranking.originalIndex back to references and honors topN locally", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    rerankMock.mockResolvedValueOnce({
      ranking: [
        { originalIndex: 2, score: 0.9, document: CANDS[2].text },
        { originalIndex: 1, score: 0.5, document: CANDS[1].text },
        { originalIndex: 0, score: 0.1, document: CANDS[0].text }
      ]
    });
    const out = await rerankCandidates({ query: "reconciliation", candidates: CANDS, topN: 2 });
    expect(out).not.toBeNull();
    expect(out!.map((c) => c.reference)).toEqual(["Rom 5:10", "Eph 2:16"]);
    expect(out!.length).toBe(2);
    // documents sent to the reranker are the candidate texts, in order
    expect(rerankMock.mock.calls[0][0].documents).toEqual(CANDS.map((c) => c.text));
    expect(rerankMock.mock.calls[0][0].query).toBe("reconciliation");
    // model is the configured plain gateway model-id string (no @ai-sdk/gateway provider object)
    expect(rerankMock.mock.calls[0][0].model).toBe(RERANK_MODEL);
    expect(rerankMock.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
    expect(rerankMock.mock.calls[0][0].maxRetries).toBe(1);
  });

  it("returns null when the rerank call throws (timeout/network/malformed)", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    rerankMock.mockRejectedValueOnce(new Error("boom"));
    const out = await rerankCandidates({ query: "x", candidates: CANDS });
    expect(out).toBeNull();
  });

  it("returns null when the response has no ranking array", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    rerankMock.mockResolvedValueOnce({});
    const out = await rerankCandidates({ query: "x", candidates: CANDS });
    expect(out).toBeNull();
  });

  it("returns null when the ranking array is empty", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    rerankMock.mockResolvedValueOnce({ ranking: [] });
    const out = await rerankCandidates({ query: "x", candidates: CANDS });
    expect(out).toBeNull();
  });

  it("returns null when ranking.originalIndex is out of range", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    rerankMock.mockResolvedValueOnce({
      ranking: [{ originalIndex: 999, score: 0.9, document: "missing" }]
    });
    const out = await rerankCandidates({ query: "x", candidates: CANDS });
    expect(out).toBeNull();
  });

  it("returns all mapped candidates in ranked order when topN is omitted", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    rerankMock.mockResolvedValueOnce({
      ranking: [
        { originalIndex: 2, score: 0.9, document: CANDS[2].text },
        { originalIndex: 0, score: 0.4, document: CANDS[0].text },
        { originalIndex: 1, score: 0.2, document: CANDS[1].text }
      ]
    });
    const out = await rerankCandidates({ query: "reconciliation", candidates: CANDS });
    expect(out).not.toBeNull();
    expect(out!.map((c) => c.reference)).toEqual(["Rom 5:10", "John 1:1", "Eph 2:16"]);
    expect(out!.length).toBe(3);
  });
});
