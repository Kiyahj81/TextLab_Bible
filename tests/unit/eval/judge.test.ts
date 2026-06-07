import { describe, expect, it, vi, beforeEach } from "vitest";

const { generateObjectMock } = vi.hoisted(() => ({ generateObjectMock: vi.fn() }));
vi.mock("ai", () => ({ generateObject: generateObjectMock }));

import { EVAL_JUDGE_MODEL, judgeFaithfulness } from "@/eval/judge";
import type { EvidencePacket } from "@/lib/ai/retrievalPlanner";

// judgeFaithfulness only reads evidence.formattedEvidence.
const EVIDENCE = { formattedEvidence: "- John 3:16, SBLGNT: ..." } as EvidencePacket;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_GATEWAY_API_KEY;
});

describe("judgeFaithfulness", () => {
  it("skips (no network call) when AI_GATEWAY_API_KEY is unset", async () => {
    const out = await judgeFaithfulness("the answer", EVIDENCE);
    expect(out.status).toBe("skipped-no-key");
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("scores supported/total when the judge returns claims", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    generateObjectMock.mockResolvedValueOnce({
      object: {
        claims: [
          { statement: "a", supported: true, reason: "in evidence" },
          { statement: "b", supported: false, reason: "not in evidence" },
          { statement: "c", supported: true, reason: "in evidence" }
        ]
      }
    });
    const out = await judgeFaithfulness("the answer", EVIDENCE);
    expect(out.status).toBe("ran");
    if (out.status !== "ran") throw new Error("expected ran");
    expect(out.result.score).toBeCloseTo(2 / 3);
    expect(out.result.claims).toHaveLength(3);
    expect(out.result.model).toBe(EVAL_JUDGE_MODEL);
  });

  it("returns an explicit error (NOT a 1.0 score) for an empty claims array", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    generateObjectMock.mockResolvedValueOnce({ object: { claims: [] } });
    const out = await judgeFaithfulness("a terse answer", EVIDENCE);
    expect(out.status).toBe("error");
    if (out.status !== "error") throw new Error("expected error");
    expect(out.message).toMatch(/zero claims/);
    expect(out.model).toBe(EVAL_JUDGE_MODEL);
  });

  it("returns a bounded error when the judge call throws (timeout/provider error)", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    generateObjectMock.mockRejectedValueOnce(new Error("x".repeat(500)));
    const out = await judgeFaithfulness("the answer", EVIDENCE);
    expect(out.status).toBe("error");
    if (out.status !== "error") throw new Error("expected error");
    expect(out.message.length).toBeLessThanOrEqual(300); // clip()-bounded, no stack/secrets
  });
});
