import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    aiSession: { findFirst: vi.fn(), create: vi.fn() },
    aiMessage: { create: vi.fn() }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/user", () => ({ localUserId: "local-user" }));

import { Prisma } from "@prisma/client";
import { recordAssistantExchange } from "@/lib/ai/sessions";
import type { AssistantAnswer } from "@/lib/ai/assistant";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.aiSession.create.mockResolvedValue({ id: "sess-1" });
});

const answer: AssistantAnswer = {
  answer: "ok",
  citations: [{ reference: "John 1:1", corpus: "SBLGNT", searchQuery: "lemma:λόγος" }],
  markdown: "# x",
  toolTrace: ["getPassage({...})"],
  mode: "fallback",
  modelRole: "default",
  modelUsed: "gpt-5.3-chat-latest",
  routingDecision: "Handled by the default model"
};

describe("recordAssistantExchange", () => {
  it("writes the user message with raw content and the assistant message with structured metadata", async () => {
    await recordAssistantExchange({ requestedSessionId: "", prompt: "What is logos?", answer });

    const writes = prismaMock.aiMessage.create.mock.calls.map((c) => c[0].data);
    expect(writes[0]).toMatchObject({
      role: "user",
      content: "What is logos?",
      metadata: Prisma.JsonNull
    });
    expect(writes[1]).toMatchObject({
      role: "assistant",
      content: "ok",
      metadata: {
        mode: "fallback",
        modelRole: "default",
        modelUsed: "gpt-5.3-chat-latest",
        routingDecision: "Handled by the default model",
        toolTrace: ["getPassage({...})"],
        citations: [{ reference: "John 1:1", corpus: "SBLGNT", searchQuery: "lemma:λόγος" }]
      }
    });
  });
});
