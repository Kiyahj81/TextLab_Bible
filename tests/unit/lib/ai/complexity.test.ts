import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPLEXITY_THRESHOLD, classifyComplexityLLM, getRouterModel, scoreComplexity } from "@/lib/ai/complexity";
import { detectConceptWords, extractSignals } from "@/lib/ai/signals";
import { getOpenAi } from "@/lib/ai/openaiClient";

vi.mock("@/lib/ai/openaiClient", () => ({ getOpenAi: vi.fn() }));
const mockedGetOpenAi = vi.mocked(getOpenAi);

beforeEach(() => {
  vi.unstubAllEnvs();
  mockedGetOpenAi.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

function clientReturning(outputText: string | undefined) {
  const create = vi.fn().mockResolvedValue({ output_text: outputText });
  // Only the surface classifyComplexityLLM touches.
  return { client: { responses: { create } } as never, create };
}

const score = (p: string) => scoreComplexity(p, extractSignals(p));

describe("scoreComplexity", () => {
  it("exports a threshold of 2", () => {
    expect(COMPLEXITY_THRESHOLD).toBe(2);
  });

  it("scores a simple lookup 0 (not complex)", () => {
    const s = score("What does John 1:1 say?");
    expect(s.score).toBe(0);
    expect(s.complex).toBe(false);
  });

  it("works without an explicit signals argument (defaults sensibly)", () => {
    // `signals` is optional — callers may omit it entirely. Verified against the
    // real extractor: no references, no concepts, no cues fire, so this exercises
    // the `signals?.references ?? []` / `signals?.intent` undefined defaults.
    const s = scoreComplexity("What does John 1:1 say?");
    expect(s.score).toBe(0);
    expect(s.complex).toBe(false);
  });

  // --- solo weak cues stay BELOW threshold (the old OR-gate over-fired on these) ---

  it("bare why-framing alone scores 1 → not complex", () => {
    // Old OR-gate escalated this; new intended behavior: default.
    // Precondition guards keep the fixture honest against extraction drift:
    const prompt = "Why did Paul write Romans?";
    expect(detectConceptWords(prompt).length).toBeLessThan(3);
    const s = score(prompt);
    expect(s.score).toBe(1);
    expect(s.complex).toBe(false);
  });

  it("concept density alone scores 1 → not complex", () => {
    // "fruit", "Spirit", "teach", "believers" hit the concept list but nothing else fires.
    const prompt = "What does the fruit of the Spirit passage teach believers?";
    expect(detectConceptWords(prompt).length).toBeGreaterThanOrEqual(3);
    const s = score(prompt);
    expect(s.score).toBe(1);
    expect(s.complex).toBe(false);
  });

  it("length alone scores 1 → not complex", () => {
    // 33 words composed almost entirely of BASE_STOP_WORDS: verified against the
    // real extractor — concepts ["once","minds"] (2 < 3), no refs, no cue phrasings.
    const verbose =
      "Could you tell me all of those things once more and then some more after that " +
      "so that we can have them all here with us before they are out of our minds";
    expect(verbose.trim().split(/\s+/).length).toBeGreaterThan(30);
    expect(detectConceptWords(verbose).length).toBeLessThan(3);
    const s = score(verbose);
    expect(s.score).toBe(1);
    expect(s.complex).toBe(false);
  });

  it("topic surveys never score concept density", () => {
    const s = score("Find verses about faith, hope, and love");
    expect(s.score).toBe(0);
    expect(s.complex).toBe(false);
  });

  // --- strong cues escalate alone ---

  it("comparison intent scores 2 → complex", () => {
    const s = score("Compare δικαιοσύνη in Romans and Galatians");
    expect(s.score).toBeGreaterThanOrEqual(2);
    expect(s.complex).toBe(true);
  });

  it("a scholarly cue word scores 2 → complex", () => {
    expect(score("Give a deep synthesis of atonement").complex).toBe(true);
    expect(score("Explain the ambiguity in this passage").complex).toBe(true);
  });

  it("two distinct book references score 2 → complex", () => {
    expect(score("Read Romans 3:28 alongside James 2:24").complex).toBe(true);
  });

  it("a 'how can ... and ...' framing cue scores 2 → complex", () => {
    // Verified against the real extractor: concepts ["grace","law","coexist",
    // "letters"] (4 >= 3), intent "general", no book refs — how-can-and(2) +
    // concept density(1) = 3.
    const prompt = "How can grace and law coexist in Paul's letters?";
    expect(detectConceptWords(prompt).length).toBeGreaterThanOrEqual(3);
    const s = score(prompt);
    expect(s.score).toBeGreaterThanOrEqual(2);
    expect(s.complex).toBe(true);
  });

  // --- weak cues combine to cross the threshold ---

  it("why-framing plus a tension cue (plus concept density) scores 4 → complex", () => {
    // why +1, scholarly cue "tension" +2, concept density (law/grace/tension) +1.
    const s = score("Why does Paul describe a tension between law and grace?");
    expect(s.score).toBe(4);
    expect(s.complex).toBe(true);
  });

  it("why-framing plus length crosses the threshold", () => {
    // 34 stopword-heavy words + "why did": verified against the real extractor —
    // concepts ["well"] (1 < 3), so the score is exactly why(1) + length(1) = 2.
    const verbose =
      "Why did they do all of those things when there were so many of them out there " +
      "and what could any of us have done about it before then and after that as well";
    expect(verbose.trim().split(/\s+/).length).toBeGreaterThan(30);
    expect(detectConceptWords(verbose).length).toBeLessThan(3);
    const s = score(verbose);
    expect(s.score).toBe(2);
    expect(s.complex).toBe(true);
  });
});

describe("getRouterModel", () => {
  it("defaults to gpt-5-mini and honors the env override", () => {
    expect(getRouterModel()).toBe("gpt-5-mini");
    vi.stubEnv("OPENAI_ROUTER_MODEL", "custom-router");
    expect(getRouterModel()).toBe("custom-router");
  });
});

describe("classifyComplexityLLM", () => {
  it("returns the parsed verdict on a valid response", async () => {
    const { client, create } = clientReturning('{"complex": true, "reason": "contested exegesis"}');
    mockedGetOpenAi.mockReturnValue(client);
    const verdict = await classifyComplexityLLM("Is Romans 7 about Paul himself?");
    expect(verdict).toEqual({ complex: true, reason: "contested exegesis" });
    // Reasoning-model params + mandatory per-request overrides.
    const [body, opts] = create.mock.calls[0];
    expect(body.model).toBe("gpt-5-mini");
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.temperature).toBeUndefined();
    expect(opts).toEqual({ timeout: 2_000, maxRetries: 0 });
  });

  it("honors a timeoutMs override (used by the smoke test's relaxed probe) but keeps maxRetries 0", async () => {
    const { client, create } = clientReturning('{"complex": false, "reason": "lookup"}');
    mockedGetOpenAi.mockReturnValue(client);
    await classifyComplexityLLM("What does John 1:1 say?", undefined, { timeoutMs: 10_000 });
    const [, opts] = create.mock.calls[0];
    expect(opts).toEqual({ timeout: 10_000, maxRetries: 0 });
  });

  it("throws when no client is configured", async () => {
    mockedGetOpenAi.mockReturnValue(null);
    await expect(classifyComplexityLLM("anything")).rejects.toThrow();
  });

  it("throws on garbage output", async () => {
    mockedGetOpenAi.mockReturnValue(clientReturning("not json").client);
    await expect(classifyComplexityLLM("anything")).rejects.toThrow();
  });

  it("throws on schema-invalid output", async () => {
    mockedGetOpenAi.mockReturnValue(clientReturning('{"complex": "yes"}').client);
    await expect(classifyComplexityLLM("anything")).rejects.toThrow();
  });

  it("propagates API errors (timeout) unchanged", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Request timed out."));
    mockedGetOpenAi.mockReturnValue({ responses: { create } } as never);
    await expect(classifyComplexityLLM("anything")).rejects.toThrow("Request timed out.");
  });
});
