import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { jwtCallback, sessionCallback, signOutEvent } from "@/lib/auth-callbacks";

beforeEach(() => {
  vi.clearAllMocks();
});

function buildSession() {
  return {
    user: { id: undefined as string | undefined, email: "u1@example.dev", name: "u1" },
    expires: new Date(Date.now() + 60_000).toISOString()
  };
}

function iatSecondsAt(iso: string) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

describe("jwtCallback", () => {
  it("stamps token.userId on initial sign-in", async () => {
    const token = await jwtCallback({ token: {} as never, user: { id: "u1" } });
    expect(token.userId).toBe("u1");
  });

  it("preserves token on subsequent calls (no user)", async () => {
    const token = await jwtCallback({ token: { userId: "u1" } as never, user: null });
    expect(token.userId).toBe("u1");
  });
});

describe("sessionCallback — JWT revocation", () => {
  it("populates session.user.id when no sessionsValidFrom is set", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
    const session = buildSession();
    const result = await sessionCallback({
      session: session as never,
      token: { userId: "u1", iat: iatSecondsAt("2026-01-01T00:00:00Z") } as never
    });
    expect(result.user?.id).toBe("u1");
  });

  it("populates session.user.id when token iat is after sessionsValidFrom", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      sessionsValidFrom: new Date("2025-01-01T00:00:00Z")
    });
    const session = buildSession();
    const result = await sessionCallback({
      session: session as never,
      token: { userId: "u1", iat: iatSecondsAt("2026-01-01T00:00:00Z") } as never
    });
    expect(result.user?.id).toBe("u1");
  });

  it("does NOT populate user.id when token iat falls before sessionsValidFrom (old cookie after sign-out)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      sessionsValidFrom: new Date("2026-02-01T00:00:00Z")
    });
    const session = buildSession();
    const result = await sessionCallback({
      session: session as never,
      token: { userId: "u1", iat: iatSecondsAt("2026-01-01T00:00:00Z") } as never
    });
    expect(result.user?.id).toBeUndefined();
  });

  it("does NOT populate user.id when token iat equals sessionsValidFrom (same-instant revocation, err safe)", async () => {
    const instant = new Date("2026-02-01T00:00:00Z");
    prismaMock.user.findUnique.mockResolvedValue({ sessionsValidFrom: instant });
    const session = buildSession();
    const result = await sessionCallback({
      session: session as never,
      token: { userId: "u1", iat: iatSecondsAt(instant.toISOString()) } as never
    });
    expect(result.user?.id).toBeUndefined();
  });

  it("returns session unchanged when token has no userId", async () => {
    const session = buildSession();
    const result = await sessionCallback({
      session: session as never,
      token: { iat: iatSecondsAt("2026-01-01T00:00:00Z") } as never
    });
    expect(result.user?.id).toBeUndefined();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("signOutEvent — bumps sessionsValidFrom", () => {
  it("updates user.sessionsValidFrom when token.userId is present", async () => {
    prismaMock.user.update.mockResolvedValue({});
    await signOutEvent({ token: { userId: "u1" } as never });
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.user.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "u1" });
    expect(call.data.sessionsValidFrom).toBeInstanceOf(Date);
  });

  it("is a no-op when token has no userId", async () => {
    await signOutEvent({ token: {} as never });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("is a no-op when token is null", async () => {
    await signOutEvent({ token: null });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
