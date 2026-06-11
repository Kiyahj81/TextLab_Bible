import { describe, expect, it } from "vitest";
import { normalizeSearchMode } from "@/lib/searchMode";

describe("normalizeSearchMode", () => {
  it("accepts every valid mode", () => {
    expect(normalizeSearchMode("keyword")).toBe("keyword");
    expect(normalizeSearchMode("lemma")).toBe("lemma");
    expect(normalizeSearchMode("morphology")).toBe("morphology");
    expect(normalizeSearchMode("domain")).toBe("domain");
  });

  it("falls back to keyword for unknown or missing values", () => {
    expect(normalizeSearchMode("garbage")).toBe("keyword");
    expect(normalizeSearchMode(undefined)).toBe("keyword");
    expect(normalizeSearchMode(null)).toBe("keyword");
    expect(normalizeSearchMode("")).toBe("keyword");
  });
});
