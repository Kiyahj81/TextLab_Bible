// tests/unit/eval/references.test.ts
import { describe, expect, it } from "vitest";
import { canonicalizeReference, referenceSet, intersectionSize } from "@/eval/references";

describe("canonicalizeReference", () => {
  it("normalizes alias + spacing to canonical osisId form", () => {
    expect(canonicalizeReference("1 Corinthians 13:1")).toBe("1Cor 13:1");
    expect(canonicalizeReference("1cor 13:1")).toBe("1Cor 13:1");
    expect(canonicalizeReference("John 3:16")).toBe("John 3:16");
  });
  it("returns null for unparseable input", () => {
    expect(canonicalizeReference("not a reference")).toBeNull();
  });
});

describe("referenceSet / intersectionSize", () => {
  it("dedupes and intersects canonically", () => {
    const a = referenceSet(["1 Corinthians 13:1", "1cor 13:1", "John 3:16"]);
    const b = referenceSet(["1Cor 13:1"]);
    expect(a.size).toBe(2);
    expect(intersectionSize(a, b)).toBe(1);
  });
});
