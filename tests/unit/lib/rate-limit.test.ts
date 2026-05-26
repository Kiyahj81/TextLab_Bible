import { afterEach, describe, expect, it } from "vitest";
import {
  consume,
  getClientIp,
  rateLimitKey,
  resetRateLimits,
  shouldEnforceLocalRateLimit
} from "@/lib/rate-limit";

const opts = { burst: 3, refillPerSecond: 1 };

afterEach(() => {
  resetRateLimits();
});

describe("consume", () => {
  it("allows up to burst, then rejects with retry-after", () => {
    expect(consume("k", opts, 0).allowed).toBe(true);
    expect(consume("k", opts, 0).allowed).toBe(true);
    expect(consume("k", opts, 0).allowed).toBe(true);
    const denied = consume("k", opts, 0);
    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error("unexpected allowed");
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("refills tokens over time", () => {
    for (let i = 0; i < 3; i++) consume("k", opts, 0);
    expect(consume("k", opts, 0).allowed).toBe(false);
    // 1 second elapsed → 1 token refilled
    expect(consume("k", opts, 1_000).allowed).toBe(true);
  });

  it("keys are independent", () => {
    for (let i = 0; i < 3; i++) consume("a", opts, 0);
    expect(consume("a", opts, 0).allowed).toBe(false);
    expect(consume("b", opts, 0).allowed).toBe(true);
  });
});

describe("rateLimitKey", () => {
  it("prefers userId", () => {
    expect(rateLimitKey({ userId: "u1", ip: "1.1.1.1", scope: "x" })).toBe("x:user:u1");
  });

  it("falls back to ip", () => {
    expect(rateLimitKey({ ip: "1.1.1.1", scope: "x" })).toBe("x:ip:1.1.1.1");
  });

  it("falls back to anon", () => {
    expect(rateLimitKey({ scope: "x" })).toBe("x:anon");
  });
});

describe("getClientIp", () => {
  it("trusts cf-connecting-ip first", () => {
    const h = new Headers({ "cf-connecting-ip": "1.1.1.1", "x-vercel-forwarded-for": "2.2.2.2" });
    expect(getClientIp(h)).toBe("1.1.1.1");
  });

  it("uses x-vercel-forwarded-for, splitting commas", () => {
    const h = new Headers({ "x-vercel-forwarded-for": "3.3.3.3, 4.4.4.4" });
    expect(getClientIp(h)).toBe("3.3.3.3");
  });

  it("falls back to x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "5.5.5.5" });
    expect(getClientIp(h)).toBe("5.5.5.5");
  });

  it("ignores untrusted x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "9.9.9.9" });
    expect(getClientIp(h)).toBe("unknown");
  });
});

describe("shouldEnforceLocalRateLimit", () => {
  it("returns true by default in tests", () => {
    expect(shouldEnforceLocalRateLimit()).toBe(true);
  });

  it("returns false when VERCEL=1", () => {
    const prev = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      expect(shouldEnforceLocalRateLimit()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prev;
    }
  });
});
