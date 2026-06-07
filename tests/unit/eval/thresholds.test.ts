// tests/unit/eval/thresholds.test.ts
import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "@/eval/thresholds";

describe("THRESHOLDS", () => {
  it("are all within [0,1]", () => {
    for (const value of Object.values(THRESHOLDS)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
  it("keeps the per-question recall floor at or below the mean-recall gate", () => {
    expect(THRESHOLDS.minRecall).toBeLessThanOrEqual(THRESHOLDS.meanRecall);
  });
  it("requires perfect citation resolvability and lemma coverage", () => {
    expect(THRESHOLDS.citationResolvability).toBe(1);
    expect(THRESHOLDS.lemmaCoverage).toBe(1);
  });
  // NOTE (Finding 6): after calibration (Task 11), tighten this suite to assert
  // the EXACT calibrated meanRecall / meanPrecision / minRecall values, so an
  // accidental threshold edit is caught — not just out-of-bounds values.
});
