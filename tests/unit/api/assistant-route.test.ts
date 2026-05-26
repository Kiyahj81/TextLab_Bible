import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, assistantMock } = vi.hoisted(() => ({
  prismaMock: {
    aiSession: { findFirst: vi.fn(), create: vi.fn() },
    aiMessage: { create: vi.fn() }
  },
  assistantMock: vi.fn()
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/user", () => ({ localUserId: "local-user" }));
vi.mock("@/lib/ai/assistant", () => ({
  answerBibleQuestion: assistantMock
}));

import { POST } from "@/app/api/assistant/route";
import { resetRateLimits } from "@/lib/rate-limit";

function jsonRequest(body: unknown) {
  return new Request("http://test/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  prismaMock.aiSession.create.mockResolvedValue({ id: "sess-1" });
  prismaMock.aiSession.findFirst.mockResolvedValue(null);
  prismaMock.aiMessage.create.mockResolvedValue({ id: "msg-1" });
  assistantMock.mockResolvedValue({
    answer: "ok",
    citations: [],
    markdown: "# x",
    toolTrace: [],
    mode: "fallback",
    modelRole: "default",
    modelUsed: "gpt-5.3-chat-latest",
    routingDecision: "Handled by the default model"
  });
});

afterEach(() => {
  resetRateLimits();
});

describe("POST /api/assistant", () => {
  it("rejects an empty prompt with 400", async () => {
    const res = await POST(jsonRequest({ prompt: "" }));
    expect(res.status).toBe(400);
    expect(assistantMock).not.toHaveBeenCalled();
  });

  it("rejects a prompt over the length cap with 400", async () => {
    const huge = "x".repeat(2_001);
    const res = await POST(jsonRequest({ prompt: huge }));
    expect(res.status).toBe(400);
    expect(assistantMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized body with 413", async () => {
    const req = new Request("http://test/api/assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(17_000)
      },
      body: JSON.stringify({ prompt: "x".repeat(17_000) })
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(assistantMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const req = new Request("http://test/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json"
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("succeeds when below all caps", async () => {
    const res = await POST(jsonRequest({ prompt: "What is logos?" }));
    expect(res.status).toBe(200);
    expect(assistantMock).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.sessionId).toBe("sess-1");
  });

  it("returns 429 with Retry-After after burst exhaustion", async () => {
    // Burst is 10/minute → 11th call within the same minute trips the limit
    for (let i = 0; i < 10; i++) {
      const ok = await POST(jsonRequest({ prompt: `q${i}` }));
      expect(ok.status).toBe(200);
    }
    const denied = await POST(jsonRequest({ prompt: "one too many" }));
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBeTruthy();
    const retry = Number.parseInt(denied.headers.get("Retry-After") ?? "0", 10);
    expect(retry).toBeGreaterThanOrEqual(1);
  });
});
