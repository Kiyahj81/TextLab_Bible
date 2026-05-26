import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock, requireAuthMock } = vi.hoisted(() => ({
  prismaMock: {
    importRun: { findMany: vi.fn() }
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
import { GET } from "@/app/api/import-runs/route";

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ ok: true, userId: "local-user" });
  prismaMock.importRun.findMany.mockResolvedValue([]);
});

describe("GET /api/import-runs", () => {
  it("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthenticated." }, { status: 401 })
    });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(prismaMock.importRun.findMany).not.toHaveBeenCalled();
  });

  it("returns the most recent import runs (capped at 25) when authenticated", async () => {
    prismaMock.importRun.findMany.mockResolvedValue([
      { id: "ir-1", source: "morphgnt", startedAt: new Date() }
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.importRuns).toHaveLength(1);
    expect(prismaMock.importRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startedAt: "desc" }, take: 25 })
    );
  });

  it("propagates Prisma errors (no swallowing) so Next can render 500", async () => {
    prismaMock.importRun.findMany.mockRejectedValue(new Error("db down"));
    await expect(GET()).rejects.toThrow("db down");
  });
});
