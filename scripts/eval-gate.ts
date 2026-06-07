// scripts/eval-gate.ts
import goldenSet from "@/eval/dataset/golden-set.json";
import { goldenSetSchema } from "@/eval/dataset/schema";
import { runDeterministic } from "@/eval/runner";
import { aggregate } from "@/eval/metrics";
import { THRESHOLDS } from "@/eval/thresholds";

async function main() {
  const items = goldenSetSchema.parse(goldenSet);
  const results = [];
  for (const item of items) results.push(await runDeterministic(item));

  const agg = aggregate(results.map((r) => ({
    recall: r.recall, precision: r.precision, citationsResolve: r.citationsResolve,
    lemmaRequired: r.lemmaRequired, lemmaFound: r.lemmaFound
  })));

  const checks = [
    { label: "Mean Context Recall", value: agg.meanRecall, min: THRESHOLDS.meanRecall },
    { label: "Mean Context Precision", value: agg.meanPrecision, min: THRESHOLDS.meanPrecision },
    { label: "Per-question recall floor", value: agg.minRecall, min: THRESHOLDS.minRecall },
    { label: "Required lemma coverage", value: agg.lemmaCoverage, min: THRESHOLDS.lemmaCoverage },
    { label: "Citation resolvability", value: agg.citationResolvability, min: THRESHOLDS.citationResolvability }
  ];

  console.log(`\nTextLab eval gate (deterministic) — ${results.length} questions\n`);
  let failed = false;
  for (const c of checks) {
    const ok = c.value >= c.min;
    if (!ok) failed = true;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.label}: ${c.value.toFixed(3)} (>= ${c.min})`);
  }

  const worst = [...results].sort((a, b) => a.recall - b.recall).slice(0, 3);
  console.log("\nLowest-recall questions:");
  for (const r of worst) console.log(`  ${r.recall.toFixed(2)}  ${r.item.id} — ${r.item.question}`);

  // Name any question whose citations did not all resolve — actionable on failure.
  const unresolved = results.filter((r) => !r.citationsResolve);
  if (unresolved.length) {
    console.log("\nQuestions with unresolvable citations:");
    for (const r of unresolved) console.log(`  ${r.item.id} — ${r.item.question}`);
  }

  if (failed) { console.error("\nEval gate FAILED.\n"); process.exit(1); }
  console.log("\nEval gate passed.\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
