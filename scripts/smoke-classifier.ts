// scripts/smoke-classifier.ts
// Live smoke test for the complexity classifier (spec: required before merge).
// Verifies the exact production call — Responses API, strict JSON schema,
// reasoning effort "low", 2s timeout, no retry — against the real model,
// with the same extracted signals production supplies (intent + book count),
// so the merge blocker validates the real classifier prompt, not a variant.
import { classifyComplexityLLM, getRouterModel } from "@/lib/ai/complexity";
import { extractSignals } from "@/lib/ai/signals";

const PROMPTS: Array<{ prompt: string; expect: boolean }> = [
  { prompt: "What does John 3:16 say?", expect: false },
  { prompt: "Is Romans 7 about Paul himself?", expect: true },
  { prompt: "Does James contradict Paul on justification?", expect: true },
  { prompt: "Find verses about hope", expect: false }
];

async function main() {
  console.log(`Classifier smoke test — model: ${getRouterModel()}\n`);
  let mismatches = 0;
  for (const { prompt, expect } of PROMPTS) {
    const started = Date.now();
    try {
      const verdict = await classifyComplexityLLM(prompt, extractSignals(prompt));
      const ok = verdict.complex === expect;
      if (!ok) mismatches++;
      console.log(
        `${ok ? "OK  " : "MISS"} [${Date.now() - started}ms] complex=${verdict.complex} (expected ${expect}) — "${prompt}"\n      reason: ${verdict.reason}`
      );
    } catch (err) {
      mismatches++;
      console.log(`FAIL [${Date.now() - started}ms] "${prompt}" — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\n${mismatches === 0 ? "Smoke test passed." : `${mismatches} mismatch(es) — review the classifier instructions.`}`);
  process.exit(mismatches === 0 ? 0 : 1);
}

main();
