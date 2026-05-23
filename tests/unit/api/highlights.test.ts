import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    verse: { findUnique: vi.fn() },
    token: { findUnique: vi.fn() },
    highlight: { create: vi.fn() }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/user", () => ({ localUserId: "local-user" }));

import { POST } from "@/app/api/highlights/route";

beforeEach(() => {
  vi.clearAllMocks();
});

function jsonRequest(body: unknown) {
  return new Request("http://test/api/highlights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/highlights", () => {
  it("returns 400 when neither verseId nor tokenId is supplied", async () => {
    const res = await POST(jsonRequest({ color: "#fde68a" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when verseId does not exist", async () => {
    prismaMock.verse.findUnique.mockResolvedValue(null);
    const res = await POST(jsonRequest({ verseId: "x", color: "#fde68a" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "verseId not found." });
    expect(prismaMock.highlight.create).not.toHaveBeenCalled();
  });

  it("returns 400 when tokenId does not exist", async () => {
    prismaMock.token.findUnique.mockResolvedValue(null);
    const res = await POST(jsonRequest({ tokenId: "x", color: "#fde68a" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "tokenId not found." });
    expect(prismaMock.highlight.create).not.toHaveBeenCalled();
  });

  it("creates a highlight when verseId resolves", async () => {
    prismaMock.verse.findUnique.mockResolvedValue({ id: "v1" });
    prismaMock.highlight.create.mockResolvedValue({ id: "h1" });
    const res = await POST(jsonRequest({ verseId: "v1", color: "#fde68a" }));
    expect(res.status).toBe(201);
    expect(prismaMock.highlight.create).toHaveBeenCalledTimes(1);
  });
});
