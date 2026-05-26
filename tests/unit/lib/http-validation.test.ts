import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  jsonError,
  readJsonLimited,
  validateBody,
  DEFAULT_MAX_BODY_BYTES
} from "@/lib/http/validation";

function makeRequest(body: string | undefined, headers: Record<string, string> = {}) {
  return new Request("http://test/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body
  });
}

describe("jsonError", () => {
  it("returns a NextResponse with the supplied status", async () => {
    const res = jsonError("nope", 418);
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "nope" });
  });

  it("includes details when supplied", async () => {
    const res = jsonError("invalid", 400, [{ path: "field", message: "bad" }]);
    expect(await res.json()).toEqual({
      error: "invalid",
      details: [{ path: "field", message: "bad" }]
    });
  });
});

describe("readJsonLimited", () => {
  it("parses valid JSON", async () => {
    const result = await readJsonLimited(makeRequest(JSON.stringify({ a: 1 })));
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toEqual({ a: 1 });
  });

  it("returns 400 on malformed JSON", async () => {
    const result = await readJsonLimited(makeRequest("{not-json"));
    if (result.ok) throw new Error("expected error");
    expect(result.response.status).toBe(400);
  });

  it("returns 413 when Content-Length exceeds the limit", async () => {
    const body = "x".repeat(DEFAULT_MAX_BODY_BYTES + 1);
    const result = await readJsonLimited(
      makeRequest(body, { "Content-Length": String(body.length) })
    );
    if (result.ok) throw new Error("expected error");
    expect(result.response.status).toBe(413);
  });

  it("returns 413 when body byte-length exceeds the limit (no Content-Length)", async () => {
    const body = JSON.stringify({ v: "x".repeat(DEFAULT_MAX_BODY_BYTES) });
    const result = await readJsonLimited(makeRequest(body));
    if (result.ok) throw new Error("expected error");
    expect(result.response.status).toBe(413);
  });

  it("returns empty object for empty body", async () => {
    const result = await readJsonLimited(makeRequest(""));
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toEqual({});
  });

  it("respects a custom maxBytes", async () => {
    const result = await readJsonLimited(makeRequest(JSON.stringify({ a: 1 })), { maxBytes: 2 });
    if (result.ok) throw new Error("expected error");
    expect(result.response.status).toBe(413);
  });
});

describe("validateBody", () => {
  const schema = z.object({ n: z.number().int().min(0) });

  it("returns ok with parsed data on success", () => {
    const result = validateBody({ n: 5 }, schema);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toEqual({ n: 5 });
  });

  it("returns 400 with details on schema failure", async () => {
    const result = validateBody({ n: -1 }, schema);
    if (result.ok) throw new Error("expected error");
    expect(result.response.status).toBe(400);
    const body = await result.response.json();
    expect(body.error).toBe("Invalid request body.");
    expect(Array.isArray(body.details)).toBe(true);
  });
});
