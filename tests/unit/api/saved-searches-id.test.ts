import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock, requireAuthMock } = vi.hoisted(() => ({
  prismaMock: {
    savedSearch: { updateMany: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn() }
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
import { DELETE, PATCH } from "@/app/api/saved-searches/[id]/route";

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ ok: true, userId: "local-user" });
});

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("PATCH /api/saved-searches/[id]", () => {
  it("returns 400 when label is empty", async () => {
    const res = await PATCH(
      jsonRequest("http://test/api/saved-searches/x", "PATCH", { label: "   " }),
      { params: Promise.resolve({ id: "x" }) }
    );
    expect(res.status).toBe(400);
    expect(prismaMock.savedSearch.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the id does not exist", async () => {
    prismaMock.savedSearch.updateMany.mockResolvedValue({ count: 0 });
    const res = await PATCH(
      jsonRequest("http://test/api/saved-searches/x", "PATCH", { label: "renamed" }),
      { params: Promise.resolve({ id: "x" }) }
    );
    expect(res.status).toBe(404);
    expect(prismaMock.savedSearch.findFirst).not.toHaveBeenCalled();
  });

  it("rejects an overlong label (>100 chars)", async () => {
    const res = await PATCH(
      jsonRequest("http://test/api/saved-searches/ss-1", "PATCH", { label: "x".repeat(101) }),
      { params: Promise.resolve({ id: "ss-1" }) }
    );
    expect(res.status).toBe(400);
    expect(prismaMock.savedSearch.updateMany).not.toHaveBeenCalled();
  });

  it("returns 200 with the updated savedSearch on success", async () => {
    prismaMock.savedSearch.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.savedSearch.findFirst.mockResolvedValue({ id: "ss-1", label: "renamed" });
    const res = await PATCH(
      jsonRequest("http://test/api/saved-searches/ss-1", "PATCH", { label: "renamed" }),
      { params: Promise.resolve({ id: "ss-1" }) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ savedSearch: { id: "ss-1", label: "renamed" } });
  });
});

describe("DELETE /api/saved-searches/[id]", () => {
  it("returns 404 when the id does not exist", async () => {
    prismaMock.savedSearch.deleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(
      new Request("http://test/api/saved-searches/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: "x" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 200 when the saved search is deleted", async () => {
    prismaMock.savedSearch.deleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(
      new Request("http://test/api/saved-searches/ss-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "ss-1" }) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe("auth gating", () => {
  it("PATCH returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthenticated." }, { status: 401 })
    });
    const res = await PATCH(
      jsonRequest("http://test/api/saved-searches/x", "PATCH", { label: "renamed" }),
      { params: Promise.resolve({ id: "x" }) }
    );
    expect(res.status).toBe(401);
    expect(prismaMock.savedSearch.updateMany).not.toHaveBeenCalled();
  });

  it("DELETE returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthenticated." }, { status: 401 })
    });
    const res = await DELETE(
      new Request("http://test/api/saved-searches/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: "x" }) }
    );
    expect(res.status).toBe(401);
    expect(prismaMock.savedSearch.deleteMany).not.toHaveBeenCalled();
  });

  it("PATCH cannot reach another user's record (scoped → 0 → 404)", async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: "alice" });
    prismaMock.savedSearch.updateMany.mockResolvedValue({ count: 0 });
    const res = await PATCH(
      jsonRequest("http://test/api/saved-searches/ss-of-bob", "PATCH", { label: "renamed" }),
      { params: Promise.resolve({ id: "ss-of-bob" }) }
    );
    expect(res.status).toBe(404);
    expect(prismaMock.savedSearch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "alice" }) })
    );
  });
});
