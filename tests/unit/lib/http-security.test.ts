import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { assertSameOrigin } from "@/lib/http/security";

function makeRequest(headers: Record<string, string>) {
  return new Request("http://localhost:3000/api/something", {
    method: "POST",
    headers
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertSameOrigin", () => {
  it("allows requests with no Origin (non-browser clients)", () => {
    const result = assertSameOrigin(makeRequest({ host: "localhost:3000" }));
    expect(result.ok).toBe(true);
  });

  it("allows same-origin requests where Origin matches Host", () => {
    const result = assertSameOrigin(
      makeRequest({ host: "localhost:3000", origin: "http://localhost:3000" })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects cross-origin requests with 403", async () => {
    const result = assertSameOrigin(
      makeRequest({ host: "localhost:3000", origin: "https://evil.example.com" })
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toMatchObject({
      error: "Cross-origin request rejected."
    });
  });

  it("uses x-forwarded-proto when comparing protocols", () => {
    const result = assertSameOrigin(
      makeRequest({
        host: "example.com",
        origin: "https://example.com",
        "x-forwarded-proto": "https"
      })
    );
    expect(result.ok).toBe(true);
  });

  it("treats Origin with a different protocol as cross-origin", () => {
    const result = assertSameOrigin(
      makeRequest({
        host: "example.com",
        origin: "http://example.com",
        "x-forwarded-proto": "https"
      })
    );
    expect(result.ok).toBe(false);
  });

  it("accepts Origin matching AUTH_URL when Host differs", () => {
    vi.stubEnv("AUTH_URL", "https://configured.example.com");
    const result = assertSameOrigin(
      makeRequest({
        host: "internal-lb-host",
        origin: "https://configured.example.com"
      })
    );
    expect(result.ok).toBe(true);
  });

  it("accepts Origin matching APP_URL when AUTH_URL is unset", () => {
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("APP_URL", "https://app.example.com");
    const result = assertSameOrigin(
      makeRequest({
        host: "internal-lb-host",
        origin: "https://app.example.com"
      })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed Origin header", () => {
    const result = assertSameOrigin(
      makeRequest({ host: "localhost:3000", origin: "not a url" })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects when Origin is set but no expected origins can be derived", () => {
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("APP_URL", "");
    // No Host header either — Request enforces presence so we use empty.
    const req = new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { origin: "https://attacker.example" }
    });
    const result = assertSameOrigin(req);
    expect(result.ok).toBe(false);
  });
});
