// eval/gate.ts
// Type-aware gate evaluation. Applies two global hard gates (citation
// resolvability, required lemma coverage) to every item, plus per-query-type
// recall/precision gates from TYPE_GATES. Metrics not gated for a type (or whole
// report-only types like conceptual/domain) are ignored here — they are still
// computed and shown in the report, but never fail the build.
import type { QueryType } from "@/eval/dataset/schema";
import type { RunResult } from "@/eval/runner";
import { GLOBAL_GATES, TYPE_GATES } from "@/eval/thresholds";

export type GateCheck = { label: string; passed: boolean; detail: string };
export type GateOutcome = { passed: boolean; checks: GateCheck[] };

export function evaluateGate(results: RunResult[]): GateOutcome {
  const checks: GateCheck[] = [];

  // --- Global hard gate: citation resolvability (every item) ---
  if (GLOBAL_GATES.citationResolvability >= 1) {
    const unresolved = results.filter((r) => !r.citationsResolve);
    checks.push({
      label: `Citation resolvability (${results.length} items)`,
      passed: unresolved.length === 0,
      detail:
        unresolved.length === 0
          ? "100% — every cited reference resolves"
          : `unresolvable citations in: ${unresolved.map((r) => r.item.id).join(", ")}`
    });
  }

  // --- Global hard gate: required lemma coverage (items declaring a lemma) ---
  if (GLOBAL_GATES.lemmaCoverage >= 1) {
    const required = results.filter((r) => r.lemmaRequired);
    const missing = required.filter((r) => !r.lemmaFound);
    checks.push({
      label: `Required lemma coverage (${required.length} items)`,
      passed: missing.length === 0,
      detail:
        missing.length === 0
          ? "100% — every required lemma surfaced"
          : `lemma missing in: ${missing.map((r) => r.item.id).join(", ")}`
    });
  }

  // --- Per-item, per-type metric gates ---
  for (const r of results) {
    const gate = TYPE_GATES[r.item.queryType as QueryType];
    if (gate.recall !== undefined) {
      checks.push({
        label: `recall · ${r.item.id} (${r.item.queryType})`,
        passed: r.recall >= gate.recall,
        detail: `${r.recall.toFixed(2)} (>= ${gate.recall})`
      });
    }
    if (gate.precision !== undefined) {
      checks.push({
        label: `precision · ${r.item.id} (${r.item.queryType})`,
        passed: r.precision >= gate.precision,
        detail: `${r.precision.toFixed(2)} (>= ${gate.precision})`
      });
    }
  }

  return { passed: checks.every((c) => c.passed), checks };
}
