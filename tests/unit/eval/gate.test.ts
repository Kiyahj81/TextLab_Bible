// tests/unit/eval/gate.test.ts
import { describe, expect, it } from "vitest";
import { evaluateGate } from "@/eval/gate";
import type { RunResult } from "@/eval/runner";
import type { GoldenItem, QueryType } from "@/eval/dataset/schema";

function item(id: string, queryType: QueryType, extra: Partial<GoldenItem> = {}): GoldenItem {
  return { id, question: id, queryType, goldenReferences: ["John 3:16"], ...extra };
}

function res(over: Partial<RunResult> & { item: GoldenItem }): RunResult {
  return {
    mode: "deterministic",
    retrievedReferences: [],
    hits: [],
    recall: 1,
    precision: 1,
    citationsResolve: true,
    lemmaRequired: false,
    lemmaFound: false,
    rerankStatus: null,
    rerankCandidateCount: null,
    synthesisStatus: "not-run",
    synthesisModel: null,
    judgeStatus: "not-run",
    judgeModel: null,
    faithfulness: null,
    ...over
  } satisfies RunResult;
}

describe("evaluateGate", () => {
  it("passes when global + type gates are all met", () => {
    const out = evaluateGate([
      res({ item: item("a", "exact-verse"), recall: 1, precision: 1 }),
      // conceptual is report-only — low recall/precision must NOT fail the gate
      res({ item: item("b", "conceptual"), recall: 0, precision: 0 })
    ]);
    expect(out.passed).toBe(true);
  });

  it("fails on an unresolvable citation (global hard gate)", () => {
    const out = evaluateGate([res({ item: item("a", "exact-verse"), citationsResolve: false })]);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.label.startsWith("Citation resolvability"))?.passed).toBe(false);
  });

  it("fails on a missing required lemma (global hard gate)", () => {
    const out = evaluateGate([
      res({ item: item("a", "lemma-survey", { mustContainLemma: "x" }), lemmaRequired: true, lemmaFound: false })
    ]);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.label.startsWith("Required lemma coverage"))?.passed).toBe(false);
  });

  it("gates BOTH recall and precision for exact-verse", () => {
    const out = evaluateGate([res({ item: item("a", "exact-verse"), recall: 1, precision: 0.5 })]);
    expect(out.passed).toBe(false); // precision 0.5 < 1
  });

  it("gates recall but NOT precision for lemma-survey (precision report-only)", () => {
    const out = evaluateGate([res({ item: item("a", "lemma-survey"), recall: 1, precision: 0.1 })]);
    expect(out.passed).toBe(true);
  });

  it("does not gate recall/precision for conceptual or domain (report-only types)", () => {
    const out = evaluateGate([
      res({ item: item("c", "conceptual"), recall: 0, precision: 0 }),
      res({ item: item("d", "domain"), recall: 0, precision: 0 })
    ]);
    expect(out.passed).toBe(true);
  });
});
