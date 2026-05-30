import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock, requireAuthMock } = vi.hoisted(() => ({
  prismaMock: {
    generatedStudyNote: { create: vi.fn(), findMany: vi.fn() }
  },
  requireAuthMock: vi.fn()
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({
  requireAuth: requireAuthMock,
  getOptionalUserId: vi.fn().mockResolvedValue("local-user"),
  requirePageAuth: vi.fn().mockResolvedValue("local-user")
}));

import { NextResponse } from "next/server";
import { GET, POST } from "@/app/api/generated-study-notes/route";

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ ok: true, userId: "local-user" });
  prismaMock.generatedStudyNote.create.mockImplementation(({ data }: { data: unknown }) =>
    Promise.resolve({ id: "gn-1", ...(data as Record<string, unknown>) })
  );
  prismaMock.generatedStudyNote.findMany.mockResolvedValue([]);
});

function jsonRequest(body: unknown) {
  return new Request("http://test/api/generated-study-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "What does logos mean in John 1:1?",
    answer: "It refers to the divine Word.",
    markdown: "## Answer\n\nIt refers to the divine Word.",
    ...overrides
  };
}

describe("GET /api/generated-study-notes", () => {
  it("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthenticated." }, { status: 401 })
    });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(prismaMock.generatedStudyNote.findMany).not.toHaveBeenCalled();
  });

  it("scopes findMany to the authenticated user", async () => {
    prismaMock.generatedStudyNote.findMany.mockResolvedValue([{ id: "gn-1" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(prismaMock.generatedStudyNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "local-user" } })
    );
  });
});

describe("POST /api/generated-study-notes", () => {
  it("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthenticated." }, { status: 401 })
    });
    const res = await POST(jsonRequest(validBody()));
    expect(res.status).toBe(401);
    expect(prismaMock.generatedStudyNote.create).not.toHaveBeenCalled();
  });

  it("returns 400 on malformed JSON", async () => {
    const req = new Request("http://test/api/generated-study-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json"
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(prismaMock.generatedStudyNote.create).not.toHaveBeenCalled();
  });

  it("returns 413 when body exceeds the 128 KB cap", async () => {
    const huge = "x".repeat(129 * 1024);
    const res = await POST(jsonRequest(validBody({ markdown: huge })));
    expect(res.status).toBe(413);
    expect(prismaMock.generatedStudyNote.create).not.toHaveBeenCalled();
  });

  it("accepts a full-chapter-sized generated note (whole passage, both corpora)", async () => {
    // A whole NT chapter across SBLGNT + WEB renders an ~13 KB fallback answer.
    // This exceeded the previous 10 KB answer cap; raised so completeness persists.
    const res = await POST(
      jsonRequest(validBody({ answer: "x".repeat(13_500), markdown: "x".repeat(14_000) }))
    );
    expect(res.status).toBe(201);
    expect(prismaMock.generatedStudyNote.create).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty prompt with 400", async () => {
    const res = await POST(jsonRequest(validBody({ prompt: "" })));
    expect(res.status).toBe(400);
  });

  it("rejects an overlong prompt with 400", async () => {
    const res = await POST(jsonRequest(validBody({ prompt: "x".repeat(2_001) })));
    expect(res.status).toBe(400);
  });

  it("rejects an overlong answer with 400", async () => {
    const res = await POST(jsonRequest(validBody({ answer: "x".repeat(40_001) })));
    expect(res.status).toBe(400);
  });

  it("rejects an overlong markdown with 400", async () => {
    const res = await POST(jsonRequest(validBody({ markdown: "x".repeat(48_001) })));
    expect(res.status).toBe(400);
  });

  it("rejects more than 50 citations with 400", async () => {
    const citations = Array.from({ length: 51 }, (_, i) => ({ reference: `John 1:${i}` }));
    const res = await POST(jsonRequest(validBody({ citations })));
    expect(res.status).toBe(400);
  });

  it("persists the note scoped to the authenticated user, not the request body", async () => {
    const res = await POST(
      jsonRequest({ ...validBody(), userId: "attacker", citations: [{ reference: "John 1:1" }] })
    );
    expect(res.status).toBe(201);
    const args = prismaMock.generatedStudyNote.create.mock.calls[0][0];
    expect(args.data.userId).toBe("local-user");
    expect(args.data.prompt).toBe("What does logos mean in John 1:1?");
    expect(args.data.citations).toEqual([{ reference: "John 1:1" }]);
  });
});
