// tests/unit/eval/dataset.test.ts
import { describe, expect, it } from "vitest";
import goldenSet from "@/eval/dataset/golden-set.json";
import { goldenSetSchema, QUERY_TYPES } from "@/eval/dataset/schema";
import { canonicalizeReference } from "@/eval/references";

describe("golden-set.json", () => {
  const parsed = goldenSetSchema.parse(goldenSet);

  it("validates against the schema", () => {
    expect(parsed.length).toBeGreaterThanOrEqual(15);
  });
  it("has unique ids", () => {
    const ids = parsed.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("covers every query type at least once", () => {
    const present = new Set(parsed.map((item) => item.queryType));
    for (const type of QUERY_TYPES) expect(present).toContain(type);
  });
  it("uses only parseable canonical references", () => {
    for (const item of parsed) {
      for (const ref of item.goldenReferences) {
        expect(canonicalizeReference(ref), `${item.id}: ${ref}`).toBe(ref);
      }
    }
  });
});
