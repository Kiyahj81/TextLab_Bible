import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { EvidencePacket } from "@/lib/ai/retrievalPlanner";

const { responsesCreate } = vi.hoisted(() => ({ responsesCreate: vi.fn() }));
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function (this: unknown) {
    return { responses: { create: responsesCreate } };
  })
}));

const { getPassage } = vi.hoisted(() => ({ getPassage: vi.fn() }));
vi.mock("@/lib/search", () => ({ getPassage }));

const evidence: EvidencePacket = {
  citations: [
    {
      reference: "Rom 7:1",
      corpus: "SBLGNT",
      searchQuery: "lemma:νόμος",
      toolName: "searchLemma",
      tokenId: "t1"
    }
  ],
  toolTrace: [{ tool: "searchLemma", args: { lemma: "νόμος" } }],
  formattedEvidence: "### searchLemma(νόμος)\n| Rom 7:1 | νόμος | N-NSM | ἐν νόμῳ |"
};

const routing = {
  modelRole: "default" as const,
  modelUsed: "gpt-5-chat-latest",
  routingDecision: ""
};

beforeEach(() => {
  vi.unstubAllEnvs();
  responsesCreate.mockReset();
  getPassage.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("synthesizeWithRefinement", () => {
  it("returns the model answer directly when no tool calls are emitted", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    responsesCreate.mockResolvedValue({ output: [], output_text: JSON.stringify({ answer: "Final answer", claims: [] }) });

    const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
    const result = await synthesizeWithRefinement({ prompt: "What does νόμος mean?", evidence, routing });

    expect(result?.answer).toBe("Final answer");
    expect(result?.citations).toEqual(evidence.citations);
    expect(responsesCreate).toHaveBeenCalledTimes(1);
    const firstArgs = responsesCreate.mock.calls[0][0];
    expect(Array.isArray(firstArgs.tools)).toBe(true);
    expect(firstArgs.tools[0].name).toBe("getPassage");
    expect(firstArgs.tool_choice).toBe("auto");
  });

  it("executes a single getPassage refinement then synthesizes again without tools", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    responsesCreate
      .mockResolvedValueOnce({
        output: [
          {
            type: "function_call",
            name: "getPassage",
            arguments: JSON.stringify({ corpus: "SBLGNT", book: "Rom", chapter: 7, verseStart: 2 }),
            call_id: "c1"
          }
        ],
        output_text: ""
      })
      .mockResolvedValueOnce({ output: [], output_text: JSON.stringify({ answer: "Refined answer", claims: [] }) });
    getPassage.mockResolvedValue({
      corpus: "SBLGNT",
      references: [{ book: "Rom", chapter: 7, verse: 2, reference: "Rom 7:2", text: "οἴδαμεν γὰρ" }]
    });

    const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
    const result = await synthesizeWithRefinement({ prompt: "Romans 7", evidence, routing });

    expect(result?.answer).toBe("Refined answer");
    expect(getPassage).toHaveBeenCalledTimes(1);
    expect(responsesCreate).toHaveBeenCalledTimes(2);
    // The second (refinement-synthesis) call must register no tools — hard cap.
    expect(responsesCreate.mock.calls[1][0].tools).toBeUndefined();
    expect(result?.citations.some((c) => c.reference === "Rom 7:2")).toBe(true);
  });

  it("executes all getPassage calls emitted in the first round", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    responsesCreate
      .mockResolvedValueOnce({
        output: [
          {
            type: "function_call",
            name: "getPassage",
            arguments: JSON.stringify({ corpus: "SBLGNT", book: "Rom", chapter: 7, verseStart: 2 }),
            call_id: "c1"
          },
          {
            type: "function_call",
            name: "getPassage",
            arguments: JSON.stringify({ corpus: "WEB", book: "Rom", chapter: 7, verseStart: 2 }),
            call_id: "c2"
          }
        ],
        output_text: ""
      })
      .mockResolvedValueOnce({ output: [], output_text: JSON.stringify({ answer: "Refined answer", claims: [] }) });
    getPassage.mockResolvedValue({
      corpus: "SBLGNT",
      references: [{ book: "Rom", chapter: 7, verse: 2, reference: "Rom 7:2", text: "x" }]
    });

    const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
    await synthesizeWithRefinement({ prompt: "Romans 7", evidence, routing });

    expect(getPassage).toHaveBeenCalledTimes(2);
    expect(responsesCreate).toHaveBeenCalledTimes(2);
  });

  it("registers verseEnd as required + nullable so the strict tool schema is valid", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    responsesCreate.mockResolvedValue({ output: [], output_text: JSON.stringify({ answer: "ok", claims: [] }) });

    const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
    await synthesizeWithRefinement({ prompt: "x", evidence, routing });

    const tool = responsesCreate.mock.calls[0][0].tools[0];
    expect(tool.strict).toBe(true);
    // OpenAI strict mode requires every property to appear in `required`.
    expect(tool.parameters.required).toEqual(
      expect.arrayContaining(["corpus", "book", "chapter", "verseStart", "verseEnd"])
    );
    expect(tool.parameters.properties.verseEnd.type).toEqual(expect.arrayContaining(["integer", "null"]));
  });

  it("coerces a null verseEnd to a single-verse fetch", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    responsesCreate
      .mockResolvedValueOnce({
        output: [
          {
            type: "function_call",
            name: "getPassage",
            arguments: JSON.stringify({ corpus: "SBLGNT", book: "Rom", chapter: 7, verseStart: 2, verseEnd: null }),
            call_id: "c1"
          }
        ],
        output_text: ""
      })
      .mockResolvedValueOnce({ output: [], output_text: JSON.stringify({ answer: "done", claims: [] }) });
    getPassage.mockResolvedValue({
      corpus: "SBLGNT",
      references: [{ book: "Rom", chapter: 7, verse: 2, reference: "Rom 7:2", text: "x" }]
    });

    const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
    await synthesizeWithRefinement({ prompt: "Romans 7", evidence, routing });

    expect(getPassage.mock.calls[0][0].verseEnd).toBeUndefined();
  });

  it("attributes a getPassage DB failure to getPassage and still completes synthesis", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    responsesCreate
      .mockResolvedValueOnce({
        output: [
          {
            type: "function_call",
            name: "getPassage",
            arguments: JSON.stringify({ corpus: "SBLGNT", book: "Rom", chapter: 7, verseStart: 2 }),
            call_id: "c1"
          }
        ],
        output_text: ""
      })
      .mockResolvedValueOnce({ output: [], output_text: JSON.stringify({ answer: "Refined despite DB error", claims: [] }) });
    getPassage.mockRejectedValue(new Error("db connection lost"));

    const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
    const result = await synthesizeWithRefinement({ prompt: "Romans 7", evidence, routing });

    expect(result?.answer).toBe("Refined despite DB error");
    expect(result?.toolTrace.some((t) => t.tool === "getPassage" && t.error === "db connection lost")).toBe(true);
    expect(result?.toolTrace.some((t) => t.tool === "openai.responses.create" && t.error)).toBe(false);
  });

  it("returns null without calling the SDK when OPENAI_API_KEY is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
    const result = await synthesizeWithRefinement({ prompt: "hi", evidence, routing });

    expect(result).toBeNull();
    expect(responsesCreate).not.toHaveBeenCalled();
  });

  it("returns null when the model produces empty text on the direct path", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    responsesCreate.mockResolvedValue({ output: [], output_text: "   " });

    const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
    const result = await synthesizeWithRefinement({ prompt: "hi", evidence, routing });

    expect(result).toBeNull();
  });

  it("caps the citations included in the model payload at 20 entries", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    responsesCreate.mockResolvedValue({ output: [], output_text: JSON.stringify({ answer: "ok", claims: [] }) });

    const manyCitations = Array.from({ length: 50 }, (_, idx) => ({
      reference: `Rom ${idx + 1}:1`,
      corpus: "SBLGNT",
      searchQuery: `q${idx}`
    }));

    const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
    await synthesizeWithRefinement({
      prompt: "hi",
      evidence: { ...evidence, citations: manyCitations },
      routing
    });

    const userText = responsesCreate.mock.calls[0][0].input[0].content[0].text as string;
    const marker = "Retrieved citations:\n";
    const jsonSlice = userText.slice(userText.indexOf(marker) + marker.length);
    const parsed = JSON.parse(jsonSlice) as unknown[];
    expect(parsed).toHaveLength(20);
  });

  it("never instructs the model to call search/passage tools as a routine step", async () => {
    const { SYNTHESIS_SYSTEM_PROMPT } = await import("@/lib/ai/synthesis");
    expect(SYNTHESIS_SYSTEM_PROMPT).not.toContain("call the relevant search or passage tool");
  });

  it("parses structured output into answer + claims", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    responsesCreate.mockResolvedValue({
      output: [],
      output_text: JSON.stringify({
        answer: "The Word was with God.",
        claims: [{ reference: "John 1:1", greekQuote: "ἐν ἀρχῇ", gloss: "in beginning", englishQuote: null }]
      })
    });

    const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
    const result = await synthesizeWithRefinement({ prompt: "John 1", evidence, routing });

    expect(result?.answer).toBe("The Word was with God.");
    expect(result?.claims).toEqual([
      { reference: "John 1:1", greekQuote: "ἐν ἀρχῇ", gloss: "in beginning", englishQuote: null }
    ]);
  });

  it("returns null when the structured output is not valid JSON", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    responsesCreate.mockResolvedValue({ output: [], output_text: "not json at all" });

    const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
    const result = await synthesizeWithRefinement({ prompt: "x", evidence, routing });

    expect(result).toBeNull();
  });

  it("requests a strict json_schema output format on the synthesis call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    responsesCreate.mockResolvedValue({ output: [], output_text: JSON.stringify({ answer: "ok", claims: [] }) });

    const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
    await synthesizeWithRefinement({ prompt: "x", evidence, routing });

    const format = responsesCreate.mock.calls[0][0].text.format;
    expect(format.type).toBe("json_schema");
    expect(format.strict).toBe(true);
    expect(format.schema.properties.claims.type).toBe("array");
  });
});

describe("buildDeterministicFallback", () => {
  it("renders a three-section answer from the evidence", async () => {
    const { buildDeterministicFallback } = await import("@/lib/ai/synthesis");
    const text = buildDeterministicFallback("What does νόμος mean?", evidence);

    expect(text).toContain("Textual observations");
    expect(text).toContain("Interpretive suggestion");
    expect(text).toContain("Application/reflection");
    expect(text).toContain("νόμος");
  });

  it("explains when no evidence was retrieved", async () => {
    const { buildDeterministicFallback } = await import("@/lib/ai/synthesis");
    const text = buildDeterministicFallback("anything", {
      citations: [],
      toolTrace: [],
      formattedEvidence: "No retrieval signals produced evidence from the corpus."
    });

    expect(text).toContain("No retrieval signals produced evidence from the corpus.");
  });
});

describe("buildRefusalAnswer", () => {
  it("renders an insufficient-evidence message with failed claims and the real evidence", async () => {
    const { buildRefusalAnswer } = await import("@/lib/ai/synthesis");
    const report = {
      grounded: false,
      verdicts: [
        {
          claim: { reference: "John 99:99", greekQuote: "x", gloss: null, englishQuote: null },
          status: "reference-not-found" as const
        }
      ]
    };
    const text = buildRefusalAnswer("what about John 99?", evidence, report);

    expect(text).toContain("Insufficient textual evidence");
    expect(text).toContain("John 99:99");
    expect(text).toContain(evidence.formattedEvidence);
    // Paragraph breaks (blank lines) must survive — the message is rendered in a <pre>.
    expect(text).toContain("\n\n");
  });
});

describe("appendAlignmentNotes", () => {
  it("returns the answer unchanged when no verdict carries a caveat", async () => {
    const { appendAlignmentNotes } = await import("@/lib/ai/synthesis");
    const report = {
      grounded: true,
      verdicts: [
        {
          claim: { reference: "John 1:1", greekQuote: "x", gloss: null, englishQuote: null },
          status: "verified" as const
        }
      ]
    };
    expect(appendAlignmentNotes("ANSWER", report)).toBe("ANSWER");
  });

  it("appends a translation alignment note when a WEB aid was caveated", async () => {
    const { appendAlignmentNotes } = await import("@/lib/ai/synthesis");
    const report = {
      grounded: true,
      verdicts: [
        {
          claim: { reference: "1 John 2:23", greekQuote: "x", gloss: null, englishQuote: "y" },
          status: "verified" as const,
          alignmentCaveat:
            "The WEB display translation does not align with the SBLGNT evidence here; the English aid was withheld."
        }
      ]
    };
    const text = appendAlignmentNotes("ANSWER", report);

    expect(text).toContain("ANSWER");
    expect(text).toContain("Translation alignment note:");
    expect(text).toContain("1 John 2:23");
  });
});
