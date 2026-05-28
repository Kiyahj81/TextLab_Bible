import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  getMaxOutputTokens,
  getModelForRole,
  isLiveAssistantEnabled,
  recommendScholarlyUpgrade,
  routeAssistantPrompt
} from "@/lib/ai/modelRouter";

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
});

describe("recommendScholarlyUpgrade", () => {
  it("returns undefined for ordinary prompts", () => {
    expect(recommendScholarlyUpgrade("What does love mean?")).toBeUndefined();
  });

  it("returns an upgrade for scholarly prompts", () => {
    const upgrade = recommendScholarlyUpgrade("I need a deep synthesis with theological nuance");
    expect(upgrade?.modelRole).toBe("scholarly");
    expect(typeof upgrade?.model).toBe("string");
  });
});

describe("getModelForRole", () => {
  it("returns the default model and honors the env override", () => {
    expect(getModelForRole("default")).toBe("gpt-5.3-chat-latest");
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
  it("defaults to 1200", () => {
    expect(getMaxOutputTokens()).toBe(1200);
  });

  it("honors a valid env override", () => {
    vi.stubEnv("OPENAI_MAX_OUTPUT_TOKENS", "500");
    expect(getMaxOutputTokens()).toBe(500);
  });

  it("falls back to the default for invalid values", () => {
    vi.stubEnv("OPENAI_MAX_OUTPUT_TOKENS", "not-a-number");
    expect(getMaxOutputTokens()).toBe(1200);
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
