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
  // Compared as a RATE against the threshold so the gate behaves correctly for
  // ANY threshold value. A bare `>= 1` toggle would silently SKIP the whole
  // check the moment the threshold is relaxed below 1 (disabling it instead of
  // loosening it) — see eval-gate-calibration-philosophy.
  {
    const unresolved = results.filter((r) => !r.citationsResolve);
    const resolveRate = results.length === 0 ? 1 : (results.length - unresolved.length) / results.length;
    const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
    checks.push({
      label: `Citation resolvability (${results.length} items)`,
      passed: resolveRate >= GLOBAL_GATES.citationResolvability,
      detail:
        unresolved.length === 0
          ? "100% — every cited reference resolves"
          : `${pct(resolveRate)} resolve (>= ${pct(GLOBAL_GATES.citationResolvability)} required) — unresolvable in: ${unresolved.map((r) => r.item.id).join(", ")}`
    });
  }

  // --- Global hard gate: required lemma coverage (items declaring a lemma) ---
  {
    const required = results.filter((r) => r.lemmaRequired);
    const missing = required.filter((r) => !r.lemmaFound);
    const coverRate = required.length === 0 ? 1 : (required.length - missing.length) / required.length;
    const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
    checks.push({
      label: `Required lemma coverage (${required.length} items)`,
      passed: coverRate >= GLOBAL_GATES.lemmaCoverage,
      detail:
        missing.length === 0
          ? "100% — every required lemma surfaced"
          : `${pct(coverRate)} covered (>= ${pct(GLOBAL_GATES.lemmaCoverage)} required) — lemma missing in: ${missing.map((r) => r.item.id).join(", ")}`
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

  // --- Routing expectations (deterministic score) — items that declare one ---
  for (const r of results) {
    if (!r.item.expectedRouting) continue;
    checks.push({
      label: `routing · ${r.item.id} (${r.item.queryType})`,
      passed: r.modelRole === r.item.expectedRouting,
      detail: `${r.modelRole} via ${r.routerSource}${r.complexityScore !== null ? ` (score ${r.complexityScore})` : ""} (expected ${r.item.expectedRouting})`
    });
  }

  return { passed: checks.every((c) => c.passed), checks };
}
