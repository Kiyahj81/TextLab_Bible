import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, assistantMock, requireAuthMock } = vi.hoisted(() => ({
  prismaMock: {
    aiSession: { findFirst: vi.fn(), create: vi.fn() },
    aiMessage: { create: vi.fn() }
  },
  assistantMock: vi.fn(),
  requireAuthMock: vi.fn()
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({
  requireAuth: requireAuthMock,
  getOptionalUserId: vi.fn().mockResolvedValue("local-user"),
  requirePageAuth: vi.fn().mockResolvedValue("local-user")
}));
vi.mock("@/lib/ai/assistant", () => ({
  answerBibleQuestion: assistantMock
}));

import { NextResponse } from "next/server";
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
  requireAuthMock.mockResolvedValue({ ok: true, userId: "local-user" });
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
    modelUsed: "gpt-5-chat-latest",
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

  it("passes a user-confirmed escalate flag through to the assistant", async () => {
    const res = await POST(jsonRequest({ prompt: "deep synthesis", escalate: true }));
    expect(res.status).toBe(200);
    expect(assistantMock).toHaveBeenCalledWith("deep synthesis", { escalate: true, confirmEscalation: false });
  });

  it("defaults escalate to false when omitted", async () => {
    await POST(jsonRequest({ prompt: "What is logos?" }));
    expect(assistantMock).toHaveBeenCalledWith("What is logos?", { escalate: false, confirmEscalation: false });
  });

  it("forwards confirmEscalation to answerBibleQuestion", async () => {
    await POST(jsonRequest({ prompt: "q", confirmEscalation: true }));
    expect(assistantMock).toHaveBeenCalledWith("q", { escalate: false, confirmEscalation: true });
  });

  it("ignores a legacy autoEscalate key and falls through to the auto default", async () => {
    // autoEscalate is no longer part of the schema. A stale client's key (any value,
    // valid or not) is stripped by zod rather than mapped or rejected, so the request
    // degrades gracefully to the auto-escalation default. The durable opt-out for
    // legacy users lives in the confirm-scholarly cookie migration, not this field.
    await POST(jsonRequest({ prompt: "q", autoEscalate: false }));
    expect(assistantMock).toHaveBeenLastCalledWith("q", { escalate: false, confirmEscalation: false });
    await POST(jsonRequest({ prompt: "q", autoEscalate: "yes" }));
    expect(assistantMock).toHaveBeenLastCalledWith("q", { escalate: false, confirmEscalation: false });
    await POST(jsonRequest({ prompt: "q" }));
    expect(assistantMock).toHaveBeenLastCalledWith("q", { escalate: false, confirmEscalation: false });
  });

  it("rejects a non-boolean escalate with 400", async () => {
    const res = await POST(jsonRequest({ prompt: "x", escalate: "yes" }));
    expect(res.status).toBe(400);
    expect(assistantMock).not.toHaveBeenCalled();
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

  it("returns 401 when unauthenticated, before any rate-limit or OpenAI call", async () => {
    requireAuthMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthenticated." }, { status: 401 })
    });
    const res = await POST(jsonRequest({ prompt: "What is logos?" }));
    expect(res.status).toBe(401);
    expect(assistantMock).not.toHaveBeenCalled();
    expect(prismaMock.aiSession.create).not.toHaveBeenCalled();
  });

  it("scopes AiSession lookup to the authenticated user", async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: "alice" });
    prismaMock.aiSession.findFirst.mockResolvedValue(null);
    await POST(jsonRequest({ prompt: "x", sessionId: "sess-of-bob" }));
    expect(prismaMock.aiSession.findFirst).toHaveBeenCalledWith({
      where: { id: "sess-of-bob", userId: "alice" }
    });
  });

  it("persists grounded:false metadata for a withheld answer", async () => {
    assistantMock.mockResolvedValue({
      answer: "Insufficient textual evidence.",
      citations: [],
      markdown: "# x",
      toolTrace: [],
      mode: "live",
      grounded: false,
      groundingReport: { grounded: false, verdicts: [] },
      modelRole: "default",
      modelUsed: "gpt-5-chat-latest",
      routingDecision: "..."
    });

    const res = await POST(jsonRequest({ prompt: "bad question" }));
    expect(res.status).toBe(200);

    const assistantCall = prismaMock.aiMessage.create.mock.calls.find(
      (c) => c[0].data.role === "assistant"
    );
    expect(assistantCall).toBeDefined();
    const metadata = assistantCall![0].data.metadata as { grounded: boolean };
    expect(metadata.grounded).toBe(false);
  });
});
