// tests/unit/eval/thresholds.test.ts
import { describe, expect, it } from "vitest";
import { GLOBAL_GATES, TYPE_GATES } from "@/eval/thresholds";
import { QUERY_TYPES } from "@/eval/dataset/schema";

describe("eval gates", () => {
  it("hard gates require 100%", () => {
    expect(GLOBAL_GATES.citationResolvability).toBe(1);
    expect(GLOBAL_GATES.lemmaCoverage).toBe(1);
  });

  it("has a gate entry for every query type", () => {
    for (const t of QUERY_TYPES) expect(TYPE_GATES[t]).toBeDefined();
  });

  it("keeps all gated thresholds within [0,1]", () => {
    for (const gate of Object.values(TYPE_GATES)) {
      for (const v of Object.values(gate)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  // Locks the calibrated type-aware policy exactly (so an accidental edit is caught):
  // exact-verse + cross-chapter gate recall AND precision; lemma-survey gates recall
  // only; conceptual + domain are report-only.
  it("matches the calibrated type-aware gate policy", () => {
    expect(TYPE_GATES["exact-verse"]).toEqual({ recall: 1, precision: 1 });
    expect(TYPE_GATES["cross-chapter"]).toEqual({ recall: 1, precision: 1 });
    expect(TYPE_GATES["lemma-survey"]).toEqual({ recall: 1 });
    expect(TYPE_GATES.conceptual).toEqual({});
    expect(TYPE_GATES.domain).toEqual({});
  });
});
