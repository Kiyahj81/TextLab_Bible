import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    verse: { findUnique: vi.fn() },
    token: { findUnique: vi.fn() },
    highlight: { create: vi.fn(), deleteMany: vi.fn() }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/user", () => ({ localUserId: "local-user" }));

import { DELETE, POST } from "@/app/api/highlights/route";

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

  it("rejects englishWordIndex without verseId", async () => {
    const res = await POST(jsonRequest({ tokenId: "t1", englishWordIndex: 3, color: "#fde68a" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "englishWordIndex requires a verseId." });
  });

  it("replaces existing row when storing an english-word highlight", async () => {
    prismaMock.verse.findUnique.mockResolvedValue({ id: "v1" });
    prismaMock.highlight.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.highlight.create.mockResolvedValue({ id: "h2" });
    const res = await POST(
      jsonRequest({ verseId: "v1", englishWordIndex: 2, color: "#bfdbfe" })
    );
    expect(res.status).toBe(201);
    expect(prismaMock.highlight.deleteMany).toHaveBeenCalledWith({
      where: { userId: "local-user", verseId: "v1", englishWordIndex: 2 }
    });
    expect(prismaMock.highlight.create).toHaveBeenCalledWith({
      data: {
        userId: "local-user",
        verseId: "v1",
        tokenId: undefined,
        englishWordIndex: 2,
        color: "#bfdbfe"
      }
    });
  });
});

function deleteRequest(body: unknown) {
  return new Request("http://test/api/highlights", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("DELETE /api/highlights", () => {
  it("returns 400 when neither verseId nor tokenId is supplied", async () => {
    const res = await DELETE(deleteRequest({}));
    expect(res.status).toBe(400);
    expect(prismaMock.highlight.deleteMany).not.toHaveBeenCalled();
  });

  it("scopes deleteMany to the local user + verseId (verse-level highlight)", async () => {
    prismaMock.highlight.deleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(deleteRequest({ verseId: "v1" }));
    expect(res.status).toBe(200);
    expect(prismaMock.highlight.deleteMany).toHaveBeenCalledWith({
      where: { userId: "local-user", verseId: "v1", englishWordIndex: null }
    });
    expect(await res.json()).toEqual({ deleted: 1 });
  });

  it("scopes deleteMany to the local user + tokenId", async () => {
    prismaMock.highlight.deleteMany.mockResolvedValue({ count: 2 });
    const res = await DELETE(deleteRequest({ tokenId: "t1" }));
    expect(res.status).toBe(200);
    expect(prismaMock.highlight.deleteMany).toHaveBeenCalledWith({
      where: { userId: "local-user", tokenId: "t1", englishWordIndex: null }
    });
  });

  it("scopes deleteMany to verseId + englishWordIndex for english-word clear", async () => {
    prismaMock.highlight.deleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(deleteRequest({ verseId: "v1", englishWordIndex: 4 }));
    expect(res.status).toBe(200);
    expect(prismaMock.highlight.deleteMany).toHaveBeenCalledWith({
      where: { userId: "local-user", verseId: "v1", englishWordIndex: 4 }
    });
  });
});
