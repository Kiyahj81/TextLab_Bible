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

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("routeAssistantPrompt", () => {
  it("routes ordinary prompts to the default model with no upgrade", () => {
    const decision = routeAssistantPrompt("Show me Romans 7");
    expect(decision.modelRole).toBe("default");
    expect(decision.recommendedUpgrade).toBeUndefined();
  });

  it("attaches an advisory scholarly upgrade when scholarly cues are present", () => {
    const decision = routeAssistantPrompt("Give a scholarly analysis of the interpretive options");
    expect(decision.modelRole).toBe("default");
    expect(decision.recommendedUpgrade?.modelRole).toBe("scholarly");
  });

  it("escalates to the scholarly model when escalate is requested", () => {
    const decision = routeAssistantPrompt("Give a scholarly analysis", true);
    expect(decision.modelRole).toBe("scholarly");
    expect(decision.modelUsed).toBe("gpt-5.4");
    // Already escalated — no further upgrade should be advised.
    expect(decision.recommendedUpgrade).toBeUndefined();
  });
});

describe("recommendScholarlyUpgrade", () => {
  const rec = (p: string) => recommendScholarlyUpgrade(p, extractSignals(p));

  it("returns undefined for a simple lookup", () => {
    expect(rec("What does John 1:1 say?")).toBeUndefined();
  });

  it("recommends scholarly for cross-book tension questions", () => {
    expect(rec("How do Paul in Romans and James reconcile faith and works?")?.modelRole).toBe("scholarly");
  });

  it("recommends scholarly for a comparison prompt", () => {
    expect(rec("Compare δικαιοσύνη in Romans and Galatians")?.modelRole).toBe("scholarly");
  });

  it("still honors an explicit scholarly cue", () => {
    expect(rec("Give a deep synthesis of atonement")?.modelRole).toBe("scholarly");
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
