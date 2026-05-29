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
});
