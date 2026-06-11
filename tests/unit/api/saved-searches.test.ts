import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock, requireAuthMock } = vi.hoisted(() => ({
  prismaMock: {
    savedSearch: { create: vi.fn(), findMany: vi.fn() }
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
import { POST } from "@/app/api/saved-searches/route";

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ ok: true, userId: "local-user" });
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

  it("auto-labels without book/chapter scope when book is omitted", async () => {
    await POST(jsonRequest({ mode: "lemma", query: "λόγος" }));
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.label).toBe("lemma: λόγος");
  });

  it("auto-labels with book scope when book is supplied", async () => {
    await POST(jsonRequest({ mode: "lemma", query: "λόγος", book: "John" }));
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.label).toBe("lemma: λόγος (John)");
  });

  it("auto-labels with book and chapter scope when both are supplied", async () => {
    await POST(jsonRequest({ mode: "lemma", query: "λόγος", book: "John", chapter: 1 }));
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.label).toBe("lemma: λόγος (John 1)");
  });

  it("honors a user-supplied label over the auto-generated one", async () => {
    await POST(jsonRequest({
      mode: "lemma",
      query: "λόγος",
      book: "John",
      label: "My favorite verses"
    }));
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.label).toBe("My favorite verses");
  });

  it("rejects an overlong label (>100 chars)", async () => {
    const res = await POST(jsonRequest({
      mode: "keyword",
      query: "logos",
      label: "x".repeat(101)
    }));
    expect(res.status).toBe(400);
    expect(prismaMock.savedSearch.create).not.toHaveBeenCalled();
  });

  it("rejects an overlong query (>500 chars)", async () => {
    const res = await POST(jsonRequest({
      mode: "keyword",
      query: "x".repeat(501)
    }));
    expect(res.status).toBe(400);
    expect(prismaMock.savedSearch.create).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthenticated." }, { status: 401 })
    });
    const res = await POST(jsonRequest({ mode: "keyword", query: "logos" }));
    expect(res.status).toBe(401);
    expect(prismaMock.savedSearch.create).not.toHaveBeenCalled();
  });

  it("accepts a domain save with an ln reference and no query", async () => {
    const res = await POST(jsonRequest({ mode: "domain", ln: "33.55" }));
    expect(res.status).toBe(201);
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.mode).toBe("domain");
    expect(args.data.ln).toBe("33.55");
    expect(args.data.query).toBeNull();
  });

  it("accepts a domain save with a domain code and auto-labels from the filter", async () => {
    const res = await POST(jsonRequest({ mode: "domain", domain: "025" }));
    expect(res.status).toBe(201);
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.label).toBe("domain: 025");
  });

  it("prefers a client-supplied label for domain saves", async () => {
    await POST(jsonRequest({ mode: "domain", domain: "025", label: "domain: 25 — Attitudes and Emotions" }));
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.label).toBe("domain: 25 — Attitudes and Emotions");
  });

  it("rejects a domain save with no domain, subdomain, or ln", async () => {
    const res = await POST(jsonRequest({ mode: "domain" }));
    expect(res.status).toBe(400);
  });

  it("rejects a domain save that carries a query", async () => {
    const res = await POST(jsonRequest({ mode: "domain", ln: "33.55", query: "light" }));
    expect(res.status).toBe(400);
  });

  it("still rejects a query-mode save without a query", async () => {
    const res = await POST(jsonRequest({ mode: "lemma" }));
    expect(res.status).toBe(400);
  });

  it("ignores domain fields on query-mode saves", async () => {
    const res = await POST(jsonRequest({ mode: "lemma", query: "λόγος", domain: "025" }));
    expect(res.status).toBe(201);
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.domain).toBeNull();
  });
});
