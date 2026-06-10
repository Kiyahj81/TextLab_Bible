import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { generateObjectMock } = vi.hoisted(() => ({ generateObjectMock: vi.fn() }));
// Spread the real module so APICallError (used by the judge's retry logic and
// constructed in these tests) keeps its symbol-marker identity.
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: generateObjectMock
}));

import { APICallError } from "ai";
import { EVAL_JUDGE_MODEL, EVAL_JUDGE_TIMEOUT_MS, judgeFaithfulness } from "@/eval/judge";
import type { EvidencePacket } from "@/lib/ai/retrievalPlanner";

// judgeFaithfulness only reads evidence.formattedEvidence.
const EVIDENCE = { formattedEvidence: "- John 3:16, SBLGNT: ..." } as EvidencePacket;

// isRetryable defaults to true for statusCode 429 (rate limit).
function rateLimitError(message = "Rate limit exceeded"): APICallError {
  return new APICallError({ message, url: "https://gateway", requestBodyValues: {}, statusCode: 429 });
}

const ONE_CLAIM = { object: { claims: [{ statement: "a", supported: true, reason: "in evidence" }] } };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_GATEWAY_API_KEY;
});

afterEach(() => {
  vi.useRealTimers();
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

  it("disables SDK retries and retries a retryable provider error itself", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    generateObjectMock.mockRejectedValueOnce(rateLimitError()).mockResolvedValueOnce(ONE_CLAIM);
    vi.useFakeTimers();
    const pending = judgeFaithfulness("the answer", EVIDENCE);
    await vi.advanceTimersByTimeAsync(10_000); // cover the backoff before attempt 2
    const out = await pending;
    expect(out.status).toBe("ran");
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    // SDK-level retries must be off, or a mid-backoff abort surfaces as the
    // useless "Delay was aborted" with the real provider error swallowed.
    expect(generateObjectMock).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  });

  it("surfaces every attempt's underlying error when retries are exhausted", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    generateObjectMock
      .mockRejectedValueOnce(rateLimitError("Rate limited (first)"))
      .mockRejectedValueOnce(rateLimitError("Rate limited (second)"))
      .mockRejectedValueOnce(rateLimitError("Rate limited (third)"));
    vi.useFakeTimers();
    const pending = judgeFaithfulness("the answer", EVIDENCE);
    await vi.advanceTimersByTimeAsync(60_000); // cover both backoffs
    const out = await pending;
    expect(out.status).toBe("error");
    if (out.status !== "error") throw new Error("expected error");
    expect(generateObjectMock).toHaveBeenCalledTimes(3);
    expect(out.message).toMatch(/attempt 1: .*Rate limited \(first\)/);
    expect(out.message).toMatch(/attempt 3: .*Rate limited \(third\)/);
    expect(out.message.length).toBeLessThanOrEqual(300);
  });

  it("does not retry a non-retryable error", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    generateObjectMock.mockRejectedValueOnce(new Error("invalid schema"));
    const out = await judgeFaithfulness("the answer", EVIDENCE);
    expect(out.status).toBe("error");
    if (out.status !== "error") throw new Error("expected error");
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    expect(out.message).toMatch(/attempt 1: invalid schema/);
  });

  it("retries per-attempt timeouts and reports them as timeouts, not aborts", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
    generateObjectMock
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout());
    vi.useFakeTimers();
    const pending = judgeFaithfulness("the answer", EVIDENCE);
    await vi.advanceTimersByTimeAsync(60_000);
    const out = await pending;
    expect(out.status).toBe("error");
    if (out.status !== "error") throw new Error("expected error");
    expect(generateObjectMock).toHaveBeenCalledTimes(3);
    expect(out.message).toContain(`timed out after ${EVAL_JUDGE_TIMEOUT_MS}ms`);
  });
});
