import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import { withDbRetry, isTransientConnectionError } from "@/lib/db-retry";

function knownError(code: string, message = `error ${code}`) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "test" });
}

function initError(errorCode: string | undefined, message = "init failure") {
  return new Prisma.PrismaClientInitializationError(message, "test", errorCode);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isTransientConnectionError", () => {
  it("is true for connection-level known-request codes", () => {
    expect(isTransientConnectionError(knownError("P1001"))).toBe(true);
    expect(isTransientConnectionError(knownError("P1002"))).toBe(true);
    expect(isTransientConnectionError(knownError("P1017"))).toBe(true);
  });

  it("is true for init errors with a transient connection code", () => {
    expect(isTransientConnectionError(initError("P1001"))).toBe(true);
    expect(isTransientConnectionError(initError("P1002"))).toBe(true);
  });

  it("is true for connection-closed/reset messages on untyped or unknown-request errors", () => {
    expect(isTransientConnectionError(new Error("the server has closed the connection"))).toBe(true);
    expect(isTransientConnectionError(new Error("Connection reset by peer ECONNRESET"))).toBe(true);
    // A recycled connection can surface as an UnknownRequestError — still eligible.
    expect(
      isTransientConnectionError(
        new Prisma.PrismaClientUnknownRequestError("the server has closed the connection", { clientVersion: "test" })
      )
    ).toBe(true);
  });

  it("is false for non-transient init errors (P1000 auth, or no code)", () => {
    expect(isTransientConnectionError(initError("P1000", "authentication failed"))).toBe(false);
    expect(isTransientConnectionError(initError(undefined))).toBe(false);
  });

  it("decides Prisma typed errors by code, never by message", () => {
    // A query error whose message happens to look connection-like must NOT retry.
    expect(isTransientConnectionError(knownError("P2002", "connection closed"))).toBe(false);
  });

  it("rejects other typed Prisma errors (validation, rust-panic) even with a matching message", () => {
    expect(
      isTransientConnectionError(new Prisma.PrismaClientValidationError("connection closed", { clientVersion: "test" }))
    ).toBe(false);
    expect(
      isTransientConnectionError(new Prisma.PrismaClientRustPanicError("connection reset boom", "test"))
    ).toBe(false);
  });

  it("never retries a digest-bearing control-flow throw, even with a matching message", () => {
    const redirect = Object.assign(new Error("connection reset during NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/x;307;"
    });
    expect(isTransientConnectionError(redirect)).toBe(false);
  });

  it("is false for plain errors and non-Error values", () => {
    expect(isTransientConnectionError(new Error("some unrelated failure"))).toBe(false);
    expect(isTransientConnectionError("connection closed")).toBe(false);
    expect(isTransientConnectionError(null)).toBe(false);
  });
});

describe("withDbRetry", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns immediately on success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withDbRetry(fn, { baseDelayMs: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient error once then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(knownError("P1017")).mockResolvedValue("recovered");
    await expect(withDbRetry(fn, { baseDelayMs: 0 })).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rethrows a non-transient error immediately without retrying", async () => {
    const err = knownError("P2002");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withDbRetry(fn, { baseDelayMs: 0 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxAttempts then rethrows the transient error", async () => {
    const err = knownError("P1001");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withDbRetry(fn, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid options without calling fn (keeps the retry bounded)", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withDbRetry(fn, { maxAttempts: Number.NaN })).rejects.toBeInstanceOf(TypeError);
    await expect(withDbRetry(fn, { maxAttempts: Number.POSITIVE_INFINITY })).rejects.toBeInstanceOf(TypeError);
    await expect(withDbRetry(fn, { maxAttempts: 0 })).rejects.toBeInstanceOf(TypeError);
    await expect(withDbRetry(fn, { baseDelayMs: -1 })).rejects.toBeInstanceOf(TypeError);
    await expect(withDbRetry(fn, { baseDelayMs: Number.NaN })).rejects.toBeInstanceOf(TypeError);
    expect(fn).not.toHaveBeenCalled();
  });
});
