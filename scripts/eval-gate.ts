// scripts/eval-gate.ts
// Deterministic, DB-only, type-aware blocking gate. Runs every golden question
// through deterministic retrieval (no API key), then applies:
//   - global hard gates: citation resolvability + required lemma coverage (100%)
//   - per-type metric gates (TYPE_GATES): recall/precision where the type's golden
//     set makes them meaningful; conceptual + domain are report-only here.
import goldenSet from "@/eval/dataset/golden-set.json";
import { goldenSetSchema, type QueryType } from "@/eval/dataset/schema";
import { runDeterministic, type RunResult } from "@/eval/runner";
import { evaluateGate } from "@/eval/gate";
import { TYPE_GATES } from "@/eval/thresholds";
import { prisma } from "@/lib/db";
import { withDbRetry } from "@/lib/db-retry";

function meanBy(rows: RunResult[], pick: (r: RunResult) => number): number {
  return rows.length === 0 ? 1 : rows.reduce((a, r) => a + pick(r), 0) / rows.length;
}

async function main() {
  // Wake the (possibly auto-suspended) Neon branch before the measured loop so a
  // cold-start connection drop (P1017) can't fail the gate for reasons unrelated
  // to the change under test. The retry lives here, never inside the measured
  // loop. More patient than the read-path default (more attempts, longer
  // backoff) since the gate is a CI batch job — better to wait a few seconds for
  // the branch to wake than to flake.
  await withDbRetry(() => prisma.$queryRaw`SELECT 1`, { maxAttempts: 5, baseDelayMs: 300 });

  const items = goldenSetSchema.parse(goldenSet);
  const results: RunResult[] = [];
  for (const item of items) results.push(await runDeterministic(item));

  console.log(`\nTextLab eval gate (deterministic, type-aware) — ${results.length} questions\n`);

  // Per-type breakdown (informational): recall/precision means + which are gated.
  const types = [...new Set(results.map((r) => r.item.queryType))] as QueryType[];
  console.log("Per query type (mean recall / mean precision; * = gated):");
  for (const t of types.sort()) {
    const rows = results.filter((r) => r.item.queryType === t);
    const gate = TYPE_GATES[t];
    const rTag = gate.recall !== undefined ? "*" : " ";
    const pTag = gate.precision !== undefined ? "*" : " ";
    console.log(
      `  ${t.padEnd(14)} recall ${meanBy(rows, (r) => r.recall).toFixed(2)}${rTag}  ` +
        `precision ${meanBy(rows, (r) => r.precision).toFixed(2)}${pTag}  (n=${rows.length})`
    );
  }

  // Type-aware gate evaluation.
  const outcome = evaluateGate(results);
  const failed = outcome.checks.filter((c) => !c.passed);

  console.log(`\nGate checks: ${outcome.checks.length - failed.length}/${outcome.checks.length} passed`);
  // Always print the two global hard-gate lines; print per-item lines only on failure.
  for (const c of outcome.checks) {
    if (c.label.startsWith("Citation resolvability") || c.label.startsWith("Required lemma coverage")) {
      console.log(`  ${c.passed ? "PASS" : "FAIL"}  ${c.label}: ${c.detail}`);
    }
  }
  if (failed.length) {
    console.log("\nFailing checks:");
    for (const c of failed) console.log(`  FAIL  ${c.label}: ${c.detail}`);
    console.error("\nEval gate FAILED.\n");
    process.exit(1);
  }
  console.log("\nEval gate passed.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
