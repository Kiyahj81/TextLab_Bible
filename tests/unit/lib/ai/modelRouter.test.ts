import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  getMaxOutputTokens,
  getModelForRole,
  getTemperature,
  isLiveAssistantEnabled,
  recommendScholarlyUpgrade,
  routeAssistantPrompt
} from "@/lib/ai/modelRouter";
import { extractSignals } from "@/lib/ai/signals";
import { classifyComplexityLLM } from "@/lib/ai/complexity";

vi.mock("@/lib/ai/complexity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/complexity")>();
  return { ...actual, classifyComplexityLLM: vi.fn() };
});
const mockedClassify = vi.mocked(classifyComplexityLLM);

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("routeAssistantPrompt", () => {
  // Block body (not an implicit-return arrow): returning the mock instance itself
  // from mockReset() trips Vitest 4's hook-thenable detection and spuriously
  // fails the next test with the *previous* test's rejected value — every other
  // mockReset() beforeEach in this repo already avoids the implicit-return form.
  beforeEach(() => {
    mockedClassify.mockReset();
  });

  it("manual escalate short-circuits: scholarly + deep + manual source, no classifier call", async () => {
    const decision = await routeAssistantPrompt("Show Romans 7", { escalate: true, live: true });
    expect(decision.modelRole).toBe("scholarly");
    expect(decision.deep).toBe(true);
    expect(decision.routerSource).toBe("manual");
    expect(decision.recommendedUpgrade).toBeUndefined();
    expect(mockedClassify).not.toHaveBeenCalled();
  });

  it("live + classifier says complex → auto-escalates (scholarly, deep, llm source)", async () => {
    mockedClassify.mockResolvedValue({ complex: true, reason: "contested" });
    const prompt = "Is Romans 7 about Paul himself?";
    const decision = await routeAssistantPrompt(prompt, { live: true, signals: extractSignals(prompt) });
    expect(decision.modelRole).toBe("scholarly");
    expect(decision.deep).toBe(true);
    expect(decision.routerSource).toBe("llm");
    expect(decision.routingDecision).toContain("automatically");
  });

  it("live + classifier says simple → default model, no upgrade chip", async () => {
    mockedClassify.mockResolvedValue({ complex: false, reason: "simple lookup" });
    const decision = await routeAssistantPrompt("What does John 1:1 say?", { live: true });
    expect(decision.modelRole).toBe("default");
    expect(decision.deep).toBe(false);
    expect(decision.routerSource).toBe("llm");
    expect(decision.recommendedUpgrade).toBeUndefined();
  });

  it("live + classifier failure → score fallback with score-fallback source", async () => {
    mockedClassify.mockRejectedValue(new Error("Request timed out."));
    const prompt = "How do Paul in Romans and James reconcile faith and works?";
    const decision = await routeAssistantPrompt(prompt, { live: true, signals: extractSignals(prompt) });
    expect(decision.modelRole).toBe("scholarly"); // reconcile cue scores 2
    expect(decision.deep).toBe(true);
    expect(decision.routerSource).toBe("score-fallback");
    expect(decision.complexityScore).toBeGreaterThanOrEqual(2);
  });

  it("live=false uses the score only (never calls the classifier)", async () => {
    const prompt = "Compare δικαιοσύνη in Romans and Galatians";
    const decision = await routeAssistantPrompt(prompt, { live: false, signals: extractSignals(prompt) });
    expect(decision.routerSource).toBe("score");
    expect(decision.modelRole).toBe("scholarly");
    expect(mockedClassify).not.toHaveBeenCalled();
  });

  it("confirmEscalation restores the recommend flow: default role + upgrade chip", async () => {
    mockedClassify.mockResolvedValue({ complex: true, reason: "contested" });
    const decision = await routeAssistantPrompt("Is Romans 7 about Paul himself?", {
      live: true,
      confirmEscalation: true
    });
    expect(decision.modelRole).toBe("default");
    expect(decision.deep).toBe(false);
    expect(decision.recommendedUpgrade?.modelRole).toBe("scholarly");
    expect(decision.recommendedUpgrade?.reason).toContain("confirm");
  });

  it("simple prompt with score routing stays default with no upgrade", async () => {
    const prompt = "Why did Paul write Romans?"; // why alone = 1 < threshold
    const decision = await routeAssistantPrompt(prompt, { live: false, signals: extractSignals(prompt) });
    expect(decision.modelRole).toBe("default");
    expect(decision.deep).toBe(false);
    expect(decision.complexityScore).toBe(1);
  });
});

describe("recommendScholarlyUpgrade", () => {
  const rec = (p: string) => recommendScholarlyUpgrade(p, extractSignals(p));

  it("returns undefined for a simple lookup", () => {
    expect(rec("What does John 1:1 say?")).toBeUndefined();
  });

  it("recommends scholarly when the score crosses the threshold", () => {
    expect(rec("How do Paul in Romans and James reconcile faith and works?")?.modelRole).toBe("scholarly");
    expect(rec("Compare δικαιοσύνη in Romans and Galatians")?.modelRole).toBe("scholarly");
    expect(rec("Give a deep synthesis of atonement")?.modelRole).toBe("scholarly");
  });

  it("no longer recommends scholarly on bare why-framing (intentional change)", () => {
    // The old OR-gate escalated this on the solo cue; the weighted score does not.
    expect(rec("Why does Paul emphasize faith?")).toBeUndefined();
  });

  it("does NOT recommend scholarly for a routine multi-topic survey", () => {
    expect(rec("Find verses about faith, hope, and love")).toBeUndefined();
  });
});

describe("getModelForRole", () => {
  it("returns the default model and honors the env override", () => {
    expect(getModelForRole("default")).toBe("gpt-5-chat-latest");
    vi.stubEnv("OPENAI_DEFAULT_MODEL", "custom-default");
    expect(getModelForRole("default")).toBe("custom-default");
  });

  it("returns the scholarly model and honors the env override", () => {
    expect(getModelForRole("scholarly")).toBe("gpt-5.4");
    vi.stubEnv("OPENAI_SCHOLARLY_MODEL", "custom-scholarly");
    expect(getModelForRole("scholarly")).toBe("custom-scholarly");
  });
});

describe("getMaxOutputTokens", () => {
  it("defaults to 2400", () => {
    expect(getMaxOutputTokens()).toBe(2400);
  });

  it("honors a valid env override", () => {
    vi.stubEnv("OPENAI_MAX_OUTPUT_TOKENS", "500");
    expect(getMaxOutputTokens()).toBe(500);
  });

  it("falls back to the default for invalid values", () => {
    vi.stubEnv("OPENAI_MAX_OUTPUT_TOKENS", "not-a-number");
    expect(getMaxOutputTokens()).toBe(2400);
  });
});

describe("getTemperature", () => {
  it("defaults to 0.3", () => {
    expect(getTemperature()).toBe(0.3);
  });

  it("honors a valid env override, including 0", () => {
    vi.stubEnv("OPENAI_TEMPERATURE", "0");
    expect(getTemperature()).toBe(0);
    vi.stubEnv("OPENAI_TEMPERATURE", "0.7");
    expect(getTemperature()).toBe(0.7);
  });

  it("falls back to the default for non-numeric or out-of-range values", () => {
    vi.stubEnv("OPENAI_TEMPERATURE", "not-a-number");
    expect(getTemperature()).toBe(0.3);
    vi.stubEnv("OPENAI_TEMPERATURE", "-1");
    expect(getTemperature()).toBe(0.3);
    vi.stubEnv("OPENAI_TEMPERATURE", "3");
    expect(getTemperature()).toBe(0.3);
  });
});

describe("isLiveAssistantEnabled", () => {
  it("is false without an API key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(isLiveAssistantEnabled()).toBe(false);
  });

  it("is true with a key and no disable flag", () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    vi.stubEnv("TEXTLAB_ASSISTANT_DISABLE_LIVE", "0");
    expect(isLiveAssistantEnabled()).toBe(true);
  });

  it("is false when explicitly disabled", () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    vi.stubEnv("TEXTLAB_ASSISTANT_DISABLE_LIVE", "1");
    expect(isLiveAssistantEnabled()).toBe(false);
  });
});
