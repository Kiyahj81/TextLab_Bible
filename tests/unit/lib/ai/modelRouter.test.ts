import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    token: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    verse: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { openaiCtor, responsesCreate } = vi.hoisted(() => ({
  openaiCtor: vi.fn(),
  responsesCreate: vi.fn()
}));
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation((opts: unknown) => {
    openaiCtor(opts);
    return { responses: { create: responsesCreate } };
  })
}));

const baseLocalAnswer = {
  answer: "deterministic-draft",
  citations: [],
  markdown: "",
  toolTrace: [{ tool: "trace-line" }],
  mode: "fallback" as const,
  modelRole: "default" as const,
  modelUsed: "gpt-5.3-chat-latest",
  routingDecision: ""
};

const baseRouting = {
  modelRole: "default" as const,
  modelUsed: "gpt-5.3-chat-latest",
  routingDecision: ""
};

beforeEach(() => {
  vi.unstubAllEnvs();
  openaiCtor.mockClear();
  responsesCreate.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("synthesizeWithDefaultModel via the openai SDK", () => {
  it("constructs the SDK with the configured timeout and returns trimmed output_text", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_REQUEST_TIMEOUT_MS", "1000");
    responsesCreate.mockResolvedValue({ output_text: "  hello world  " });

    const { synthesizeWithDefaultModel } = await import("@/lib/ai/modelRouter");
    const result = await synthesizeWithDefaultModel({
      prompt: "hi",
      localAnswer: baseLocalAnswer,
      routing: baseRouting
    });

    expect(result).toBe("hello world");
    expect(openaiCtor).toHaveBeenCalledTimes(1);
    expect(openaiCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-key",
        timeout: 1000,
        maxRetries: 1
      })
    );
    expect(responsesCreate).toHaveBeenCalledTimes(1);
    const createArgs = responsesCreate.mock.calls[0][0];
    expect(createArgs.model).toBe("gpt-5.3-chat-latest");
    expect(typeof createArgs.instructions).toBe("string");
  });

  it("returns null without constructing the SDK when OPENAI_API_KEY is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const { synthesizeWithDefaultModel } = await import("@/lib/ai/modelRouter");
    const result = await synthesizeWithDefaultModel({
      prompt: "hi",
      localAnswer: baseLocalAnswer,
      routing: baseRouting
    });

    expect(result).toBeNull();
    expect(openaiCtor).not.toHaveBeenCalled();
    expect(responsesCreate).not.toHaveBeenCalled();
  });

  it("falls back to the default 25000ms timeout when OPENAI_REQUEST_TIMEOUT_MS is unset", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    responsesCreate.mockResolvedValue({ output_text: "ok" });

    const { synthesizeWithDefaultModel } = await import("@/lib/ai/modelRouter");
    await synthesizeWithDefaultModel({
      prompt: "hi",
      localAnswer: baseLocalAnswer,
      routing: baseRouting
    });

    expect(openaiCtor).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 25_000, maxRetries: 1 })
    );
  });

  it("falls back to the default 25000ms timeout when OPENAI_REQUEST_TIMEOUT_MS is invalid", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_REQUEST_TIMEOUT_MS", "not-a-number");
    responsesCreate.mockResolvedValue({ output_text: "ok" });

    const { synthesizeWithDefaultModel } = await import("@/lib/ai/modelRouter");
    await synthesizeWithDefaultModel({
      prompt: "hi",
      localAnswer: baseLocalAnswer,
      routing: baseRouting
    });

    expect(openaiCtor).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 25_000 })
    );
  });

  it("caps the citations payload at 20 entries", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    responsesCreate.mockResolvedValue({ output_text: "ok" });

    const citations = Array.from({ length: 50 }, (_, idx) => ({
      reference: `Rom ${idx + 1}:1`,
      corpus: "SBLGNT",
      searchQuery: `q${idx}`
    }));

    const { synthesizeWithDefaultModel } = await import("@/lib/ai/modelRouter");
    await synthesizeWithDefaultModel({
      prompt: "hi",
      localAnswer: { ...baseLocalAnswer, citations },
      routing: baseRouting
    });

    const createArgs = responsesCreate.mock.calls[0][0];
    const userText = createArgs.input[0].content[0].text as string;
    const marker = "Retrieved citations:\n";
    const start = userText.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const after = userText.slice(start + marker.length);
    const end = after.indexOf("\n\n");
    expect(end).toBeGreaterThan(0);
    const jsonSlice = after.slice(0, end);
    const parsed = JSON.parse(jsonSlice) as unknown[];
    expect(parsed).toHaveLength(20);
    // Confirm the JSON is compact (no pretty-print indentation).
    expect(jsonSlice).not.toContain("\n  ");
  });

  it("returns null when the SDK responds with empty output_text", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    responsesCreate.mockResolvedValue({ output_text: "   " });

    const { synthesizeWithDefaultModel } = await import("@/lib/ai/modelRouter");
    const result = await synthesizeWithDefaultModel({
      prompt: "hi",
      localAnswer: baseLocalAnswer,
      routing: baseRouting
    });

    expect(result).toBeNull();
  });
});

describe("assistant fallback when the SDK call fails", () => {
  it("falls back locally when responses.create rejects", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    responsesCreate.mockRejectedValue(new Error("openai timeout"));

    const { answerBibleQuestion } = await import("@/lib/ai/assistant");
    const answer = await answerBibleQuestion("Hello world");
    expect(answer.mode).toBe("fallback");
    expect(answer.toolTrace.some((entry) => entry.tool === "openai.responses.create" && entry.error)).toBe(true);
  });
});
