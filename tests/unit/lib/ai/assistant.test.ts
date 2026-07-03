import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EvidencePacket } from "@/lib/ai/retrievalPlanner";

const { runRetrievalPlan } = vi.hoisted(() => ({ runRetrievalPlan: vi.fn() }));
vi.mock("@/lib/ai/retrievalPlanner", () => ({ runRetrievalPlan }));

const { synthesizeWithRefinement, buildDeterministicFallback, buildRefusalAnswer, appendAlignmentNotes } = vi.hoisted(() => ({
  synthesizeWithRefinement: vi.fn(),
  buildDeterministicFallback: vi.fn(() => "FALLBACK_ANSWER"),
  buildRefusalAnswer: vi.fn(() => "REFUSAL_ANSWER"),
  // Fake that appends a marker only when a caveat is present, so the wiring is testable.
  appendAlignmentNotes: vi.fn((answer: string, report: { verdicts: Array<{ alignmentCaveat?: string }> }) =>
    report.verdicts.some((v) => v.alignmentCaveat) ? `${answer}\n[ALIGN]` : answer
  )
}));
vi.mock("@/lib/ai/synthesis", () => ({
  synthesizeWithRefinement,
  buildDeterministicFallback,
  buildRefusalAnswer,
  appendAlignmentNotes
}));

const { verifyGrounding } = vi.hoisted(() => ({ verifyGrounding: vi.fn() }));
vi.mock("@/lib/ai/grounding", () => ({ verifyGrounding }));

const { isLiveAssistantEnabled, routeAssistantPrompt } = vi.hoisted(() => ({
  isLiveAssistantEnabled: vi.fn(() => false),
  routeAssistantPrompt: vi.fn()
}));
vi.mock("@/lib/ai/modelRouter", async (importOriginal) => {
  const real = await (importOriginal as () => Promise<typeof import("@/lib/ai/modelRouter")>)();
  return { ...real, isLiveAssistantEnabled, routeAssistantPrompt };
});

// Use the hoisted `routeAssistantPrompt` mock variable DIRECTLY in the tests
// (exactly as the existing file uses `isLiveAssistantEnabled`). Do NOT also
// `import { routeAssistantPrompt } from "@/lib/ai/modelRouter"` — that would
// redeclare the identifier already bound by the vi.hoisted destructuring above.
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
  routeAssistantPrompt.mockResolvedValue({
    modelRole: "default",
    modelUsed: "gpt-5-chat-latest",
    deep: false,
    routerSource: "score",
    routingDecision: "Handled by the default model for normal retrieval planning and synthesis."
  });
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

  it("does not claim a scholarly/model pass on the non-live fallback even when escalation is requested", async () => {
    // isLiveAssistantEnabled() is false here, so no model call happens — the routing
    // metadata must not advertise the scholarly pass that escalate would have selected.
    const answer = await answerBibleQuestion("deep synthesis please", { escalate: true });

    expect(synthesizeWithRefinement).not.toHaveBeenCalled();
    expect(answer.mode).toBe("fallback");
    expect(answer.modelRole).toBe("default");
    expect(answer.modelUsed).toBe("none");
    expect(answer.routingDecision).toMatch(/disabled|no model call/i);
    expect(answer.recommendedUpgrade).toBeUndefined();
    expect(answer.deep).toBe(false);
    expect(answer.routerSource).toBe("none");
  });

  it("routes BEFORE retrieval and passes the routing depth into the planner", async () => {
    isLiveAssistantEnabled.mockReturnValue(true);
    routeAssistantPrompt.mockResolvedValue({
      modelRole: "scholarly", modelUsed: "gpt-5.4", deep: true, routerSource: "llm",
      routingDecision: "Scholarly model used automatically: test."
    });
    synthesizeWithRefinement.mockResolvedValue({ answer: "x", claims: [], citations: [], toolTrace: [] });

    await answerBibleQuestion("Is Romans 7 about Paul?");
    expect(runRetrievalPlan).toHaveBeenCalledWith(
      expect.anything(), "Is Romans 7 about Paul?", { semanticEnabled: true, deep: true }
    );
  });

  it("non-live path never routes: routerSource none, deep false, standard retrieval", async () => {
    isLiveAssistantEnabled.mockReturnValue(false);
    const answer = await answerBibleQuestion("What does John 1:1 say?");
    expect(answer.modelUsed).toBe("none");
    expect(answer.routerSource).toBe("none");
    expect(answer.deep).toBe(false);
    expect(routeAssistantPrompt).not.toHaveBeenCalled();
    expect(runRetrievalPlan).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), { semanticEnabled: false }
    );
  });

  it("forwards confirmEscalation to the router", async () => {
    isLiveAssistantEnabled.mockReturnValue(true);
    synthesizeWithRefinement.mockResolvedValue({ answer: "x", claims: [], citations: [], toolTrace: [] });
    await answerBibleQuestion("prompt", { confirmEscalation: true });
    expect(routeAssistantPrompt).toHaveBeenCalledWith(
      "prompt", expect.objectContaining({ confirmEscalation: true, live: true })
    );
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
    routeAssistantPrompt.mockResolvedValue({
      modelRole: "scholarly", modelUsed: "gpt-5.4", deep: true, routerSource: "manual",
      routingDecision: "Escalated to the scholarly model at the user's request."
    });
    synthesizeWithRefinement.mockResolvedValue({ answer: "SCHOLARLY", claims: [], citations: [], toolTrace: [] });

    const answer = await answerBibleQuestion("deep synthesis please", { escalate: true });

    expect(routeAssistantPrompt).toHaveBeenCalledWith(
      "deep synthesis please", expect.objectContaining({ escalate: true, live: true })
    );
    expect(answer.modelRole).toBe("scholarly");
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

  it("surfaces WEB alignment caveats on a grounded answer", async () => {
    isLiveAssistantEnabled.mockReturnValue(true);
    const claim = { reference: "1 John 2:23", greekQuote: "x", gloss: null, englishQuote: "y" };
    synthesizeWithRefinement.mockResolvedValue({
      answer: "GOOD ANSWER",
      claims: [claim],
      citations: packet.citations,
      toolTrace: []
    });
    verifyGrounding.mockResolvedValue({
      grounded: true,
      verdicts: [{ claim, status: "verified", alignmentCaveat: "WEB has no verse at this reference; the English display aid was withheld." }]
    });

    const answer = await answerBibleQuestion("1 John 2:23");

    expect(answer.grounded).toBe(true);
    expect(appendAlignmentNotes).toHaveBeenCalledWith("GOOD ANSWER", expect.objectContaining({ grounded: true }));
    expect(answer.answer).toContain("[ALIGN]");
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
