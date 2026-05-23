import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    savedSearch: { create: vi.fn(), findMany: vi.fn() }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/user", () => ({ localUserId: "local-user" }));

import { POST } from "@/app/api/saved-searches/route";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.savedSearch.create.mockImplementation(({ data }: { data: unknown }) =>
    Promise.resolve({ id: "ss-1", ...(data as Record<string, unknown>) })
  );
});

function jsonRequest(body: unknown) {
  return new Request("http://test/api/saved-searches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/saved-searches", () => {
  it("rejects an empty query", async () => {
    const res = await POST(jsonRequest({ mode: "keyword", query: "" }));
    expect(res.status).toBe(400);
  });

  it("strips matchMode when mode is not morphology", async () => {
    const res = await POST(jsonRequest({
      mode: "keyword",
      query: "logos",
      matchMode: "prefix"
    }));
    expect(res.status).toBe(201);
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.matchMode).toBeUndefined();
  });

  it("preserves matchMode when mode is morphology", async () => {
    const res = await POST(jsonRequest({
      mode: "morphology",
      query: "N-NSM",
      matchMode: "prefix"
    }));
    expect(res.status).toBe(201);
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.matchMode).toBe("prefix");
  });
});
