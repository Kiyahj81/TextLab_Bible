import { describe, expect, it, vi } from "vitest";

// next.config.ts computes its headers config at module-load time from
// NODE_ENV. We re-import the module after setting NODE_ENV via vi.stubEnv
// so each test sees the right branch.
async function loadHeadersForEnv(nodeEnv: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  const mod = await import("@/next.config");
  const config = mod.default;
  const result = await config.headers!();
  vi.unstubAllEnvs();
  return result as Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
}

function headerByName(
  block: { headers: Array<{ key: string; value: string }> },
  name: string
) {
  return block.headers.find((h) => h.key.toLowerCase() === name.toLowerCase());
}

describe("next.config.ts security headers", () => {
  it("applies the rule to all paths", async () => {
    const blocks = await loadHeadersForEnv("production");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toBe("/:path*");
  });

  it("emits all five baseline headers in dev and prod", async () => {
    for (const env of ["development", "production"]) {
      const blocks = await loadHeadersForEnv(env);
      const block = blocks[0];

      const required = [
        "Content-Security-Policy",
        "X-Frame-Options",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy"
      ];

      for (const key of required) {
        expect(headerByName(block, key), `${key} missing in ${env}`).toBeDefined();
      }
    }
  });

  it("sets X-Frame-Options to DENY", async () => {
    const [block] = await loadHeadersForEnv("production");
    expect(headerByName(block, "X-Frame-Options")?.value).toBe("DENY");
  });

  it("sets X-Content-Type-Options to nosniff", async () => {
    const [block] = await loadHeadersForEnv("production");
    expect(headerByName(block, "X-Content-Type-Options")?.value).toBe("nosniff");
  });

  it("sets Referrer-Policy to strict-origin-when-cross-origin", async () => {
    const [block] = await loadHeadersForEnv("production");
    expect(headerByName(block, "Referrer-Policy")?.value).toBe("strict-origin-when-cross-origin");
  });

  it("blocks camera, microphone, geolocation, payment, usb, interest-cohort in Permissions-Policy", async () => {
    const [block] = await loadHeadersForEnv("production");
    const value = headerByName(block, "Permissions-Policy")?.value ?? "";
    for (const directive of ["camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()", "interest-cohort=()"]) {
      expect(value).toContain(directive);
    }
  });

  it("emits HSTS only in production", async () => {
    const dev = await loadHeadersForEnv("development");
    const prod = await loadHeadersForEnv("production");

    expect(headerByName(dev[0], "Strict-Transport-Security")).toBeUndefined();
    expect(headerByName(prod[0], "Strict-Transport-Security")?.value).toBe(
      "max-age=31536000; includeSubDomains"
    );
  });

  it("CSP includes frame-ancestors 'none', drops api.openai.com, and drops unsafe-eval in production", async () => {
    const prod = await loadHeadersForEnv("production");
    const dev = await loadHeadersForEnv("development");

    const prodCsp = headerByName(prod[0], "Content-Security-Policy")?.value ?? "";
    const devCsp = headerByName(dev[0], "Content-Security-Policy")?.value ?? "";

    expect(prodCsp).toContain("frame-ancestors 'none'");
    expect(prodCsp).not.toContain("api.openai.com");
    expect(prodCsp).not.toContain("'unsafe-eval'");

    // Dev keeps unsafe-eval for HMR.
    expect(devCsp).toContain("'unsafe-eval'");
  });
});
