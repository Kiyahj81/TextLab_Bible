import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EvidencePacket } from "@/lib/ai/retrievalPlanner";

const { runRetrievalPlan } = vi.hoisted(() => ({ runRetrievalPlan: vi.fn() }));
vi.mock("@/lib/ai/retrievalPlanner", () => ({ runRetrievalPlan }));

const { synthesizeWithRefinement, buildDeterministicFallback, buildRefusalAnswer } = vi.hoisted(() => ({
  synthesizeWithRefinement: vi.fn(),
  buildDeterministicFallback: vi.fn(() => "FALLBACK_ANSWER"),
  buildRefusalAnswer: vi.fn(() => "REFUSAL_ANSWER")
}));
vi.mock("@/lib/ai/synthesis", () => ({ synthesizeWithRefinement, buildDeterministicFallback, buildRefusalAnswer }));

const { verifyGrounding } = vi.hoisted(() => ({ verifyGrounding: vi.fn() }));
vi.mock("@/lib/ai/grounding", () => ({ verifyGrounding }));

const { isLiveAssistantEnabled } = vi.hoisted(() => ({ isLiveAssistantEnabled: vi.fn(() => false) }));
vi.mock("@/lib/ai/modelRouter", async (importOriginal) => {
  const real = await (importOriginal as () => Promise<typeof import("@/lib/ai/modelRouter")>)();
  return { ...real, isLiveAssistantEnabled };
});

import { answerBibleQuestion, detectBookFromPrompt } from "@/lib/ai/assistant";

const packet: EvidencePacket = {
  citations: [
    { reference: "Rom 7:1", corpus: "SBLGNT", searchQuery: "lemma:νόμος", toolName: "searchLemma", tokenId: "t1" }
  ],
  toolTrace: [{ tool: "searchLemma", args: { lemma: "νόμος" } }],
  formattedEvidence: "### searchLemma(νόμος)\n| Rom 7:1 | νόμος | N-NSM | ἐν νόμῳ |"
};

beforeEach(() => {
  vi.clearAllMocks();
  buildDeterministicFallback.mockReturnValue("FALLBACK_ANSWER");
  buildRefusalAnswer.mockReturnValue("REFUSAL_ANSWER");
  verifyGrounding.mockResolvedValue({ grounded: true, verdicts: [] });
  runRetrievalPlan.mockResolvedValue(packet);
  isLiveAssistantEnabled.mockReturnValue(false);
});

describe("answerBibleQuestion orchestration", () => {
  it("runs the retrieval plan and returns a deterministic fallback when live is disabled", async () => {
    const answer = await answerBibleQuestion("What does νόμος mean in Romans 7?");

    expect(runRetrievalPlan).toHaveBeenCalledTimes(1);
    expect(synthesizeWithRefinement).not.toHaveBeenCalled();
    expect(answer.mode).toBe("fallback");
    expect(answer.answer).toBe("FALLBACK_ANSWER");
    expect(answer.citations).toEqual(packet.citations);
    expect(answer.grounded).toBe(true);
  });

  it("returns the synthesized answer when live and synthesis succeeds", async () => {
    isLiveAssistantEnabled.mockReturnValue(true);
    synthesizeWithRefinement.mockResolvedValue({
      answer: "LIVE ANSWER",
      claims: [],
      citations: [
        ...packet.citations,
        { reference: "Rom 7:2", corpus: "SBLGNT", searchQuery: "passage", toolName: "getPassage" }
      ],
      toolTrace: [...packet.toolTrace, { tool: "openai.responses.create", args: { phase: "synthesis" } }]
    });

    const answer = await answerBibleQuestion("What does νόμος mean in Romans 7?");

    expect(answer.mode).toBe("live");
    expect(answer.answer).toBe("LIVE ANSWER");
    expect(answer.citations.some((c) => c.reference === "Rom 7:2")).toBe(true);
    expect(answer.grounded).toBe(true);
  });

  it("routes to the scholarly model when escalation is requested", async () => {
    isLiveAssistantEnabled.mockReturnValue(true);
    synthesizeWithRefinement.mockResolvedValue({ answer: "SCHOLARLY", claims: [], citations: [], toolTrace: [] });

    const answer = await answerBibleQuestion("deep synthesis please", { escalate: true });

    expect(answer.modelRole).toBe("scholarly");
    expect(synthesizeWithRefinement).toHaveBeenCalledWith(
      expect.objectContaining({ routing: expect.objectContaining({ modelRole: "scholarly" }) })
    );
  });

  it("falls back when live synthesis returns null", async () => {
    isLiveAssistantEnabled.mockReturnValue(true);
    synthesizeWithRefinement.mockResolvedValue(null);

    const answer = await answerBibleQuestion("anything");

    expect(answer.mode).toBe("fallback");
    expect(answer.answer).toBe("FALLBACK_ANSWER");
    expect(answer.grounded).toBe(true);
  });

  it("falls back locally when live synthesis throws, recording the error in the trace", async () => {
    isLiveAssistantEnabled.mockReturnValue(true);
    synthesizeWithRefinement.mockRejectedValue(new Error("openai timeout"));

    const answer = await answerBibleQuestion("anything");

    expect(answer.mode).toBe("fallback");
    expect(answer.toolTrace.some((entry) => entry.tool === "openai.responses.create" && entry.error)).toBe(true);
    expect(answer.grounded).toBe(true);
  });

  it("withholds the answer when grounding fails", async () => {
    isLiveAssistantEnabled.mockReturnValue(true);
    synthesizeWithRefinement.mockResolvedValue({
      answer: "DRAFT WITH BAD CITATION",
      claims: [{ reference: "John 99:99", greekQuote: "x", gloss: null, englishQuote: null }],
      citations: [],
      toolTrace: []
    });
    verifyGrounding.mockResolvedValue({
      grounded: false,
      verdicts: [
        { claim: { reference: "John 99:99", greekQuote: "x", gloss: null, englishQuote: null }, status: "reference-not-found" }
      ]
    });

    const answer = await answerBibleQuestion("bad question");

    expect(answer.grounded).toBe(false);
    expect(answer.mode).toBe("live");
    expect(answer.answer).toBe("REFUSAL_ANSWER");
    expect(answer.answer).not.toContain("DRAFT WITH BAD CITATION");
    expect(answer.citations).toEqual(packet.citations);
    expect(answer.groundingReport?.grounded).toBe(false);
  });

  it("returns the grounded answer with grounded:true when verification passes", async () => {
    isLiveAssistantEnabled.mockReturnValue(true);
    synthesizeWithRefinement.mockResolvedValue({
      answer: "GOOD ANSWER",
      claims: [{ reference: "Rom 7:1", greekQuote: "νόμος", gloss: null, englishQuote: null }],
      citations: packet.citations,
      toolTrace: []
    });

    const answer = await answerBibleQuestion("good question");

    expect(answer.grounded).toBe(true);
    expect(answer.answer).toBe("GOOD ANSWER");
  });

  it("falls back deterministically when verification throws (infra failure)", async () => {
    isLiveAssistantEnabled.mockReturnValue(true);
    synthesizeWithRefinement.mockResolvedValue({ answer: "x", claims: [], citations: [], toolTrace: [] });
    verifyGrounding.mockRejectedValue(new Error("db connection lost"));

    const answer = await answerBibleQuestion("anything");

    expect(answer.mode).toBe("fallback");
    expect(answer.grounded).toBe(true);
    expect(answer.answer).toBe("FALLBACK_ANSWER");
  });
});

describe("book detection", () => {
  it("ignores substrings inside other words", () => {
    expect(detectBookFromPrompt("from the start")).toBeUndefined();
    expect(detectBookFromPrompt("romance languages")).toBeUndefined();
  });
  it("matches alias word boundaries", () => {
    expect(detectBookFromPrompt("Tell me about Romans 8")).toBe("Rom");
    expect(detectBookFromPrompt("john 1:1")).toBe("John");
    expect(detectBookFromPrompt("1 cor 13")).toBe("1Cor");
  });
});
