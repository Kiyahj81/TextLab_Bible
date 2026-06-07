// tests/unit/eval/metrics.test.ts
import { describe, expect, it } from "vitest";
import { contextPrecision, contextRecall, aggregate } from "@/eval/metrics";

describe("contextRecall", () => {
  // Signature is contextRecall(retrieved, golden) — matches contextPrecision and
  // the runner's contextRecall(retrieved, item.goldenReferences) call site.
  it("is the fraction of golden refs retrieved", () => {
    expect(contextRecall(["1Cor 13:1"], ["1Cor 13:1", "1Cor 13:2"])).toBe(0.5);
  });
  it("is 1 when golden is empty", () => {
    expect(contextRecall(["John 3:16"], [])).toBe(1);
  });
  it("normalizes aliases before comparing", () => {
    expect(contextRecall(["1 Corinthians 13:1"], ["1cor 13:1"])).toBe(1);
  });
});

describe("contextPrecision", () => {
  it("is the fraction of retrieved refs that are golden", () => {
    expect(contextPrecision(["1Cor 13:1", "Rom 1:1"], ["1Cor 13:1"])).toBe(0.5);
  });
  it("is 1 when both empty, 0 when golden non-empty but nothing retrieved", () => {
    expect(contextPrecision([], [])).toBe(1);
    expect(contextPrecision([], ["John 3:16"])).toBe(0);
  });
});

describe("aggregate", () => {
  it("computes means, recall floor, resolvability, and coverage", () => {
    const agg = aggregate([
      { recall: 1, precision: 1, citationsResolve: true, lemmaRequired: true, lemmaFound: true },
      { recall: 0.4, precision: 0.8, citationsResolve: true, lemmaRequired: false, lemmaFound: false }
    ]);
    expect(agg.meanRecall).toBeCloseTo(0.7);
    expect(agg.meanPrecision).toBeCloseTo(0.9);
    expect(agg.minRecall).toBe(0.4);
    expect(agg.citationResolvability).toBe(1);
    expect(agg.lemmaCoverage).toBe(1); // only the 1 required item, which was found
  });
  it("lemmaCoverage is 1 when no item requires a lemma, and drops when a required lemma is missing", () => {
    expect(aggregate([{ recall: 1, precision: 1, citationsResolve: true, lemmaRequired: false, lemmaFound: false }]).lemmaCoverage).toBe(1);
    expect(aggregate([{ recall: 1, precision: 1, citationsResolve: true, lemmaRequired: true, lemmaFound: false }]).lemmaCoverage).toBe(0);
  });
  it("citationResolvability drops when any citation fails to resolve", () => {
    expect(aggregate([
      { recall: 1, precision: 1, citationsResolve: true, lemmaRequired: false, lemmaFound: false },
      { recall: 1, precision: 1, citationsResolve: false, lemmaRequired: false, lemmaFound: false }
    ]).citationResolvability).toBe(0.5);
  });
});
