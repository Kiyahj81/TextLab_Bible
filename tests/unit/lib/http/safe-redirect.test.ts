import { describe, expect, it } from "vitest";
import { safeInternalPath } from "@/lib/http/safe-redirect";

describe("safeInternalPath", () => {
  it("allows a normal internal path", () => {
    expect(safeInternalPath("/notes")).toBe("/notes");
  });

  it("preserves query and hash on an internal path", () => {
    expect(safeInternalPath("/read?x=1#y")).toBe("/read?x=1#y");
  });

  it("rejects protocol-relative // URLs", () => {
    expect(safeInternalPath("//evil.example.com")).toBe("/read");
  });

  it("rejects the backslash open-redirect bypass /\\", () => {
    // Browsers normalize "\" to "/", so "/\evil.com" becomes "//evil.com".
    expect(safeInternalPath("/\\evil.example.com")).toBe("/read");
  });

  it("rejects any embedded backslash", () => {
    expect(safeInternalPath("/foo\\bar")).toBe("/read");
  });

  it("rejects paths that do not start with a slash", () => {
    expect(safeInternalPath("evil.example.com")).toBe("/read");
  });

  it("falls back for non-string input", () => {
    expect(safeInternalPath(null)).toBe("/read");
    expect(safeInternalPath(undefined)).toBe("/read");
  });

  it("honors a custom fallback", () => {
    expect(safeInternalPath("//evil", "/signin")).toBe("/signin");
  });

  it("rejects a single percent-encoded backslash", () => {
    // Decodes to /\evil.com.
    expect(safeInternalPath("/%5Cevil.example.com")).toBe("/read");
  });

  it("rejects a double percent-encoded backslash (the Next-decoded form)", () => {
    // What searchParams hands us after Next decodes ?callbackUrl=/%255Cevil.com once.
    expect(safeInternalPath("/%255Cevil.example.com")).toBe("/read");
  });

  it("rejects a percent-encoded protocol-relative prefix", () => {
    expect(safeInternalPath("/%2F%2Fevil.example.com")).toBe("/read");
  });

  it("rejects malformed percent-encoding", () => {
    expect(safeInternalPath("/%")).toBe("/read");
  });

  it("preserves a legitimately percent-encoded query value", () => {
    expect(safeInternalPath("/search?q=a%20b")).toBe("/search?q=a%20b");
  });
});
