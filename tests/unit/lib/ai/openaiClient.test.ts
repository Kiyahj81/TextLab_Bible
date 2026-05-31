import { describe, expect, it, beforeEach, vi } from "vitest";

const { ctor } = vi.hoisted(() => ({ ctor: vi.fn() }));
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function (this: unknown, opts: unknown) {
    ctor(opts);
    return { tag: "client" };
  })
}));

import { getOpenAi, resetOpenAiClient } from "@/lib/ai/openaiClient";

beforeEach(() => {
  vi.unstubAllEnvs();
  ctor.mockClear();
  resetOpenAiClient();
});

describe("getOpenAi", () => {
  it("returns null and does not construct the SDK without an API key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(getOpenAi()).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
  });

  it("constructs the SDK with the configured timeout and one retry", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_REQUEST_TIMEOUT_MS", "1234");
    expect(getOpenAi()).not.toBeNull();
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "test-key", timeout: 1234, maxRetries: 1 })
    );
  });

  it("falls back to a 120000ms timeout when unset or invalid", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_REQUEST_TIMEOUT_MS", "not-a-number");
    getOpenAi();
    expect(ctor).toHaveBeenCalledWith(expect.objectContaining({ timeout: 120_000 }));
  });

  it("caches the client across calls and rebuilds after reset", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const first = getOpenAi();
    const second = getOpenAi();
    expect(first).toBe(second);
    expect(ctor).toHaveBeenCalledTimes(1);

    resetOpenAiClient();
    getOpenAi();
    expect(ctor).toHaveBeenCalledTimes(2);
  });
});
