import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    verse: { findUnique: vi.fn() },
    token: { findUnique: vi.fn() },
    note: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn() }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/user", () => ({ localUserId: "local-user" }));

import { POST } from "@/app/api/notes/route";
import { PATCH, DELETE } from "@/app/api/notes/[id]/route";

beforeEach(() => {
  vi.clearAllMocks();
});

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/notes", () => {
  it("returns 400 when verseId does not exist", async () => {
    prismaMock.verse.findUnique.mockResolvedValue(null);
    const res = await POST(jsonRequest("http://test/api/notes", "POST", {
      verseId: "does-not-exist",
      body: "hi",
      tags: ["v"]
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "verseId not found." });
    expect(prismaMock.note.create).not.toHaveBeenCalled();
  });

  it("returns 400 when tokenId does not exist", async () => {
    prismaMock.token.findUnique.mockResolvedValue(null);
    const res = await POST(jsonRequest("http://test/api/notes", "POST", {
      tokenId: "does-not-exist",
      body: "hi",
      tags: ["w"]
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "tokenId not found." });
    expect(prismaMock.note.create).not.toHaveBeenCalled();
  });

  it("returns 400 when neither verseId nor tokenId is supplied", async () => {
    const res = await POST(jsonRequest("http://test/api/notes", "POST", { body: "hi" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const res = await POST(jsonRequest("http://test/api/notes", "POST", {
      verseId: "v1",
      body: "   "
    }));
    expect(res.status).toBe(400);
  });

  it("creates a note when verseId resolves", async () => {
    prismaMock.verse.findUnique.mockResolvedValue({ id: "v1" });
    prismaMock.note.create.mockResolvedValue({ id: "n1" });

    const res = await POST(jsonRequest("http://test/api/notes", "POST", {
      verseId: "v1",
      body: "hello",
      tags: ["v"]
    }));

    expect(res.status).toBe(201);
    expect(prismaMock.note.create).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/notes/[id]", () => {
  it("returns 404 when the note does not exist", async () => {
    prismaMock.note.updateMany.mockResolvedValue({ count: 0 });
    const res = await PATCH(
      jsonRequest("http://test/api/notes/does-not-exist", "PATCH", { body: "edit" }),
      { params: Promise.resolve({ id: "does-not-exist" }) }
    );
    expect(res.status).toBe(404);
    expect(prismaMock.note.findFirst).not.toHaveBeenCalled();
  });

  it("returns the note when update succeeds", async () => {
    prismaMock.note.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.note.findFirst.mockResolvedValue({ id: "n1", body: "edit" });
    const res = await PATCH(
      jsonRequest("http://test/api/notes/n1", "PATCH", { body: "edit" }),
      { params: Promise.resolve({ id: "n1" }) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ note: { id: "n1" } });
  });
});

describe("DELETE /api/notes/[id]", () => {
  it("returns 404 when the note does not exist", async () => {
    prismaMock.note.deleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(new Request("http://test/api/notes/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: "x" })
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 when the note is deleted", async () => {
    prismaMock.note.deleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(new Request("http://test/api/notes/n1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "n1" })
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
