import { describe, expect, it, vi, beforeEach } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }));
const { headersMock } = vi.hoisted(() => ({ headersMock: vi.fn() }));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/headers", () => ({ headers: headersMock }));

import { getOptionalUserId, requireAuth, requirePageAuth } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  headersMock.mockResolvedValue(new Headers());
});

describe("requireAuth", () => {
  it("returns 401 when no session", async () => {
    authMock.mockResolvedValue(null);
    const result = await requireAuth();
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({ error: "Unauthenticated." });
  });

  it("returns 401 when session has no user id", async () => {
    authMock.mockResolvedValue({ user: {} });
    const result = await requireAuth();
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(401);
  });

  it("returns userId on success", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: "u@x" } });
    const result = await requireAuth();
    if (!result.ok) throw new Error("expected success");
    expect(result.userId).toBe("u1");
  });
});

describe("requirePageAuth", () => {
  it("redirects to plain /signin when no session and no path header", async () => {
    authMock.mockResolvedValue(null);
    redirectMock.mockImplementation(() => {
      throw new Error("REDIRECT");
    });
    await expect(requirePageAuth()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/signin");
  });

  it("redirects with a callbackUrl when the requested path is known", async () => {
    authMock.mockResolvedValue(null);
    headersMock.mockResolvedValue(new Headers({ "x-pathname": "/notes?tag=verse" }));
    redirectMock.mockImplementation(() => {
      throw new Error("REDIRECT");
    });
    await expect(requirePageAuth()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(
      `/signin?callbackUrl=${encodeURIComponent("/notes?tag=verse")}`
    );
  });

  it("ignores an unsafe x-pathname and redirects to plain /signin", async () => {
    authMock.mockResolvedValue(null);
    headersMock.mockResolvedValue(new Headers({ "x-pathname": "//evil.example.com" }));
    redirectMock.mockImplementation(() => {
      throw new Error("REDIRECT");
    });
    await expect(requirePageAuth()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/signin");
  });

  it("returns userId when authenticated", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const userId = await requirePageAuth();
    expect(userId).toBe("u1");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("getOptionalUserId", () => {
  it("returns null when no session", async () => {
    authMock.mockResolvedValue(null);
    await expect(getOptionalUserId()).resolves.toBeNull();
  });

  it("returns userId when session present", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    await expect(getOptionalUserId()).resolves.toBe("u1");
  });
});
