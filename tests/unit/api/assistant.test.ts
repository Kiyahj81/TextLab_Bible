import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    aiSession: { findFirst: vi.fn(), create: vi.fn() },
    aiMessage: { create: vi.fn() }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { Prisma } from "@prisma/client";
import { finishAssistantExchange, startAssistantExchange } from "@/lib/ai/sessions";
import type { AssistantAnswer } from "@/lib/ai/assistant";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.aiSession.create.mockResolvedValue({ id: "sess-1" });
  prismaMock.aiMessage.create.mockResolvedValue({ id: "msg-1" });
});

const answer: AssistantAnswer = {
  answer: "ok",
  citations: [{ reference: "John 1:1", corpus: "SBLGNT", searchQuery: "lemma:λόγος" }],
  markdown: "# x",
  toolTrace: [{ tool: "getPassage", args: {} }],
  mode: "fallback",
  grounded: true,
  modelRole: "default",
  modelUsed: "gpt-5-chat-latest",
  routingDecision: "Handled by the default model"
};

describe("assistant exchange persistence", () => {
  it("writes the user message before finishAssistantExchange and assistant message with structured metadata", async () => {
    const { sessionId, userMessagePromise } = await startAssistantExchange({
      userId: "local-user",
      requestedSessionId: "",
      prompt: "What is logos?"
    });

    // User write is in-flight (initiated) before finishAssistantExchange is invoked.
    expect(prismaMock.aiMessage.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.aiMessage.create.mock.calls[0][0].data.role).toBe("user");
    expect(prismaMock.aiMessage.create.mock.calls[0][0].data).toMatchObject({
      role: "user",
      content: "What is logos?",
      metadata: Prisma.JsonNull
    });

    await finishAssistantExchange({ sessionId, userMessagePromise, answer });

    expect(prismaMock.aiMessage.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.aiMessage.create.mock.calls[1][0].data).toMatchObject({
      role: "assistant",
      content: "ok",
      metadata: {
        mode: "fallback",
        modelRole: "default",
        modelUsed: "gpt-5-chat-latest",
        routingDecision: "Handled by the default model",
        toolTrace: [{ tool: "getPassage", args: {} }],
        citations: [{ reference: "John 1:1", corpus: "SBLGNT", searchQuery: "lemma:λόγος" }]
      }
    });
  });
});
