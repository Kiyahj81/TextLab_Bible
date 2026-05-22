import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    token: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    verse: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_REQUEST_TIMEOUT_MS", "1000");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("OpenAI request timeout", () => {
  it("aborts the request after OPENAI_REQUEST_TIMEOUT_MS", async () => {
    const aborts: AbortSignal[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      aborts.push(init.signal!);
      return await new Promise<Response>((_, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { synthesizeWithDefaultModel } = await import("@/lib/ai/modelRouter");
    const assertion = expect(
      synthesizeWithDefaultModel({
        prompt: "hi",
        localAnswer: {
          answer: "x", citations: [], markdown: "", toolTrace: [],
          mode: "fallback", modelRole: "default", modelUsed: "gpt-5.3-chat-latest", routingDecision: ""
        },
        routing: { modelRole: "default", modelUsed: "gpt-5.3-chat-latest", routingDecision: "" }
      })
    ).rejects.toThrow(/abort|timed out/i);

    await vi.advanceTimersByTimeAsync(1100);
    await assertion;
    expect(aborts[0].aborted).toBe(true);
  });
});

describe("assistant fallback on timeout", () => {
  it("falls back locally when the OpenAI request times out", async () => {
    vi.useRealTimers();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_REQUEST_TIMEOUT_MS", "10");
    vi.stubGlobal("fetch", () => new Promise(() => {}));

    const { answerBibleQuestion } = await import("@/lib/ai/assistant");
    const answer = await answerBibleQuestion("Hello world");
    expect(answer.mode).toBe("fallback");
  }, 10000);
});
